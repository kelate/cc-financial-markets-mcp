#!/usr/bin/env node

/**
 * African Markets MCP Server
 *
 * Provides tools for querying African stock market data, annual reports,
 * and market news from african-markets.com via the Model Context Protocol.
 *
 * Supports two transport modes:
 *   - stdio (default): for Claude Code / Claude Desktop integration
 *   - http:  for external apps — pass --http [port] to start an HTTP server
 *
 * Real-time data freshness strategy:
 *   - Redis L2 cache stores parsed market data (JSON) across all Lambda instances
 *   - Vercel Cron (every 5 min) warms open exchanges via POST /admin/warm
 *   - On cache miss: fetch live from african-markets.com, write to Redis
 *   - Tool calls return from Redis in ~5ms instead of ~2-5s live fetch
 */

import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Cache } from "./cache/cache.js";
import { CacheWarmer } from "./cache/warmer.js";
import { RedisCache } from "./cache/redis-cache.js";
import { loadConfig } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { Fetcher } from "./scraper/fetcher.js";
import { RateLimiter } from "./scraper/rate-limiter.js";
import { ScraperFactory } from "./scraper/factory.js";
import { AFRICAN_EXCHANGES } from "./types/markets.js";
import { isMarketOpen, getOpenExchanges } from "./utils/market-hours.js";
import { GetAnnualReportsSchema, getAnnualReports } from "./tools/annual-reports.js";
import { GetCompanyDocumentsSchema, getCompanyDocuments } from "./tools/company-documents.js";
import { GetCompanyProfileSchema, getCompanyProfile } from "./tools/company-profile.js";
import { ListExchangesSchema, listExchanges } from "./tools/list-exchanges.js";
import { GetMarketDataSchema, getMarketData } from "./tools/market-data.js";
import { GetMarketNewsSchema, getMarketNews } from "./tools/market-news.js";
import { GetIndexHistorySchema, getIndexHistory } from "./tools/index-history.js";
import { GetStockHistorySchema, getStockHistory } from "./tools/stock-history.js";
import { resolveOrigin, isAuthorizedMcp } from "./auth-mcp.js";

const config = loadConfig();
setLogLevel(config.logLevel);

const cache = new Cache(config.cacheTtlSeconds);
const rateLimiter = new RateLimiter(config.rateLimitPerMinute);
const fetcher = new Fetcher({
  baseUrl: config.baseUrl,
  userAgent: config.userAgent,
  rateLimiter,
  cache,
  auth: config.auth,
});

const redis = new RedisCache(config.redis.url);
const warmer = new CacheWarmer(fetcher);

// ── Redis key helpers ─────────────────────────────────────────────────────────

const KEY = {
  market:    (code: string) => `mcp:market:${code.toLowerCase()}:all`,
  fresh:     (code: string) => `mcp:fresh:${code.toLowerCase()}`,
  warmLock:  (code: string) => `mcp:lock:warm:${code.toLowerCase()}`,
} as const;

// ── Type filter — extracts a sub-view from a fully-warmed result ──────────────

function filterByType(full: Record<string, unknown>, type: string): Record<string, unknown> {
  const { exchange, stocks, movers, indices } = full as {
    exchange: unknown; stocks: unknown; movers: unknown; indices: unknown;
  };
  switch (type) {
    case "stocks":  return { exchange, stocks };
    case "movers":  return { exchange, movers };
    case "indices": return { exchange, indices };
    default:        return full;
  }
}

// ── Data freshness metadata ───────────────────────────────────────────────────

async function buildMeta(exchangeCode: string, fromCache: boolean) {
  const freshAt = await redis.getRaw(KEY.fresh(exchangeCode));
  const ageSeconds = freshAt
    ? Math.round((Date.now() - new Date(freshAt).getTime()) / 1000)
    : null;
  return {
    fromCache,
    lastRefreshedAt: freshAt ?? null,
    dataAgeSeconds:  ageSeconds,
    marketIsOpen:    isMarketOpen(exchangeCode),
    redisEnabled:    redis.enabled,
  };
}

// ── Exchange warm (single) ────────────────────────────────────────────────────

async function warmOne(exchangeCode: string): Promise<{ ok: boolean; durationMs: number; skipped?: boolean }> {
  const exchange = AFRICAN_EXCHANGES.find(e => e.code.toUpperCase() === exchangeCode.toUpperCase());
  if (!exchange) return { ok: false, durationMs: 0 };

  const lockKey = KEY.warmLock(exchange.code);
  const locked = await redis.acquireLock(lockKey, 120);
  if (!locked) {
    logger.debug("Warm skipped — another instance already warming", { exchange: exchange.code });
    return { ok: true, durationMs: 0, skipped: true };
  }

  const t0 = Date.now();
  try {
    const strategy = ScraperFactory.getStrategy(exchange.provider, fetcher);
    // Always fetch all types at once — one scrape per exchange, no rate-limit overhead
    const data = await strategy.getMarketData(exchange, "all", true);
    const result = {
      exchange: { name: exchange.name, code: exchange.code, country: exchange.country, currency: exchange.currency },
      ...data,
    };

    await redis.set(KEY.market(exchange.code), result, config.cacheTtlSeconds);
    await redis.setRaw(KEY.fresh(exchange.code), new Date().toISOString());

    logger.info("Exchange warmed", { exchange: exchange.code, durationMs: Date.now() - t0 });
    return { ok: true, durationMs: Date.now() - t0 };
  } catch (e) {
    logger.warn("Warm failed", { exchange: exchange.code, error: (e as Error).message });
    return { ok: false, durationMs: Date.now() - t0 };
  } finally {
    await redis.releaseLock(lockKey);
  }
}

// ── Batch warm handler ────────────────────────────────────────────────────────

async function warmBatch(target: string): Promise<Record<string, { ok: boolean; durationMs: number; skipped?: boolean }>> {
  let codes: string[];

  if (target === "all") {
    codes = AFRICAN_EXCHANGES.map(e => e.code);
  } else if (target === "open") {
    codes = getOpenExchanges();
    if (codes.length === 0) {
      logger.debug("Warm skipped — no markets currently open");
      return {};
    }
  } else {
    // Single exchange code
    codes = [target.toUpperCase()];
  }

  logger.info("Warming exchanges", { target, count: codes.length, codes });

  // Sequential to avoid hammering african-markets.com (natural HTTP timing ~300ms/req is enough)
  const results: Record<string, { ok: boolean; durationMs: number; skipped?: boolean }> = {};
  for (const code of codes) {
    results[code] = await warmOne(code);
  }

  const summary = {
    ok: Object.values(results).filter(r => r.ok && !r.skipped).length,
    failed: Object.values(results).filter(r => !r.ok).length,
    skipped: Object.values(results).filter(r => r.skipped).length,
  };
  logger.info("Warm batch complete", { ...summary, target });

  return results;
}

// ── Auth check for /admin/warm ────────────────────────────────────────────────

function isAuthorizedWarm(req: IncomingMessage, url: URL): boolean {
  // Vercel Cron requests carry x-vercel-cron: 1 header (cannot be faked externally)
  if (req.headers["x-vercel-cron"] === "1") return true;
  // Manual trigger: ?secret=xxx or Authorization: Bearer xxx
  const secret = url.searchParams.get("secret")
    || (req.headers.authorization?.replace("Bearer ", "") ?? "");
  return !!config.adminSecret && secret === config.adminSecret;
}

// ── MCP server factory ────────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "cc-financial-markets",
    version: "0.2.0",
  });

  server.tool(
    "list_exchanges",
    "Liste toutes les places de marché africaines supportées avec leurs codes, pays et devises.",
    ListExchangesSchema.shape,
    async (params) => {
      const result = listExchanges(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_market_data",
    "Récupère les données de marché en temps réel (cours des actions, indices) pour une place de marché africaine.",
    GetMarketDataSchema.shape,
    async (params) => {
      try {
        const exchangeCode = params.exchange.toLowerCase();

        // ── L2 Redis cache hit ─────────────────────────────────────────────
        if (!params.force_refresh && redis.enabled) {
          const cached = await redis.get<Record<string, unknown>>(KEY.market(exchangeCode));
          if (cached) {
            const filtered = filterByType(cached, params.type);
            const meta = await buildMeta(exchangeCode, true);
            return {
              content: [{ type: "text", text: JSON.stringify({ ...filtered, meta }, null, 2) }],
            };
          }
        }

        // ── Cache miss — fetch live, then write to Redis ───────────────────
        const result = await getMarketData(params, fetcher);

        if (redis.enabled) {
          // Always store the full 'all' result regardless of requested type
          // so future requests for any sub-type are served from cache
          const fullResult = params.type === "all"
            ? result
            : await getMarketData({ ...params, type: "all", force_refresh: false }, fetcher);

          await redis.set(KEY.market(exchangeCode), fullResult, config.cacheTtlSeconds);
          await redis.setRaw(KEY.fresh(exchangeCode), new Date().toISOString());
        }

        const meta = await buildMeta(exchangeCode, false);
        return {
          content: [{ type: "text", text: JSON.stringify({ ...result, meta }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_annual_reports",
    "Récupère les rapports annuels des entreprises cotées sur une place de marché africaine. Filtrable par année et entreprise.",
    GetAnnualReportsSchema.shape,
    async (params) => {
      try {
        const result = await getAnnualReports(params, fetcher);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_company_documents",
    "Récupère l'historique complet des documents publiés par une entreprise cotée (rapports annuels, états financiers, communiqués). Nécessite un compte premium african-markets.com.",
    GetCompanyDocumentsSchema.shape,
    async (params) => {
      try {
        const result = await getCompanyDocuments(params, fetcher);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_market_news",
    "Récupère les dernières actualités et articles sur les marchés financiers africains depuis african-markets.com.",
    GetMarketNewsSchema.shape,
    async (params) => {
      try {
        const result = await getMarketNews(params, fetcher);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_company_profile",
    "Récupère le profil détaillé d'une entreprise cotée (premium): infos, rapports annuels, états financiers, communiqués, dividendes. Nécessite le code de la bourse et le symbole de l'action.",
    GetCompanyProfileSchema.shape,
    async (params) => {
      try {
        const result = await getCompanyProfile(params, fetcher);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_index_history",
    "Récupère l'historique des cours d'un indice boursier africain (close + volume quotidien depuis 2015). Données disponibles pour toutes les places de marché sans abonnement.",
    GetIndexHistorySchema.shape,
    async (params) => {
      try {
        const result = await getIndexHistory(params, fetcher);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_stock_history",
    "Récupère l'historique OHLCV d'une action individuelle cotée sur une place de marché africaine. Nécessite un compte premium african-markets.com (AFRICAN_MARKETS_USERNAME / AFRICAN_MARKETS_PASSWORD dans .env).",
    GetStockHistorySchema.shape,
    async (params) => {
      try {
        const result = await getStockHistory(params, fetcher);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// ── HTTP request handler ──────────────────────────────────────────────────────

const sessions = new Map<string, StreamableHTTPServerTransport>();

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = req.headers.host || "localhost";
  const protocol = "https";
  const baseHref = `${protocol}://${host}`;
  const url = new URL(req.url || "/", baseHref);

  const origin = resolveOrigin(req, config.allowedOrigins);
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  if (config.allowedOrigins.length > 0) res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── /admin/warm — triggered by Vercel Cron or manual request ──────────────
  if (url.pathname === "/admin/warm" && req.method === "POST") {
    if (!isAuthorizedWarm(req, url)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized. Use x-vercel-cron header or ?secret=MCP_ADMIN_SECRET." }));
      return;
    }

    const target = url.searchParams.get("exchange") || "open";
    const t0 = Date.now();

    try {
      const results = await warmBatch(target);
      const totalMs = Date.now() - t0;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, target, totalMs, exchanges: results }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
    }
    return;
  }

  // ── /health ────────────────────────────────────────────────────────────────
  if (url.pathname === "/health") {
    const openExchanges = getOpenExchanges();
    const redisPing = await redis.ping();

    // Per-exchange freshness
    const freshness: Record<string, { lastRefreshedAt: string | null; ageSeconds: number | null; marketOpen: boolean }> = {};
    await Promise.all(
      AFRICAN_EXCHANGES.map(async (e) => {
        const freshAt = await redis.getRaw(KEY.fresh(e.code));
        freshness[e.code] = {
          lastRefreshedAt: freshAt,
          ageSeconds: freshAt ? Math.round((Date.now() - new Date(freshAt).getTime()) / 1000) : null,
          marketOpen: isMarketOpen(e.code),
        };
      })
    );

    const staleOpen = Object.entries(freshness)
      .filter(([, v]) => v.marketOpen && (v.ageSeconds === null || v.ageSeconds > config.cacheTtlSeconds))
      .map(([k]) => k);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: staleOpen.length === 0 ? "ok" : "degraded",
      server: "cc-financial-markets-mcp",
      version: "0.2.0",
      redis: { enabled: redis.enabled, connected: redisPing },
      openExchanges,
      staleOpenExchanges: staleOpen,
      freshness,
      cacheWarmer: config.cacheWarmingEnabled ? warmer.stats : { enabled: false },
    }));
    return;
  }

  // ── /mcp ──────────────────────────────────────────────────────────────────
  if (url.pathname === "/mcp") {
    const accept = req.headers.accept || "";
    if (req.method === "GET" && !accept.includes("text/event-stream")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>CC Financial Markets MCP</title>
<style>body{font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#1a1a1a}
h1{color:#d35400}code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:0.9em}
pre{background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;overflow-x:auto;font-size:0.85em}
.status{display:inline-block;background:#27ae60;color:#fff;padding:4px 12px;border-radius:12px;font-size:0.85em}
.redis{display:inline-block;background:${redis.enabled ? "#27ae60" : "#e74c3c"};color:#fff;padding:4px 12px;border-radius:12px;font-size:0.85em;margin-left:8px}</style>
</head>
<body>
<h1>🌍 CC Financial Markets MCP Server</h1>
<p><span class="status">● En ligne</span><span class="redis">● Redis ${redis.enabled ? "connecté" : "désactivé"}</span></p>
<p>Données boursières africaines via <strong>MCP (Model Context Protocol)</strong> — cache Redis partagé, warm automatique toutes les 5 min.</p>
<h2>Outils disponibles</h2>
<ul>
<li><code>list_exchanges</code> — 20 places de marché africaines</li>
<li><code>get_market_data</code> — cours, movers, indices (Redis L2 cache, TTL ${config.cacheTtlSeconds}s)</li>
<li><code>get_annual_reports</code> — rapports et publications PDF</li>
<li><code>get_market_news</code> — actualités financières</li>
<li><code>get_index_history</code> — historique de l'indice (close/volume, depuis 2015)</li>
<li><code>get_stock_history</code> — historique OHLCV d'une action (premium)</li>
<li><code>get_company_documents</code> — documents complets d'une entreprise (premium)</li>
</ul>
<h2>Endpoints</h2>
<ul>
<li><code>POST /mcp</code> — MCP protocol</li>
<li><code>GET /health</code> — status + fraîcheur par exchange</li>
<li><code>POST /admin/warm?exchange=all|open|BRVM</code> — déclenche le warm (auth requise)</li>
</ul>
</body></html>`);
      return;
    }

    // Auth required for all non-GET MCP requests
    if (!isAuthorizedMcp(req, config.mcpApiKeys)) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized. Provide a valid Bearer token in Authorization header." },
        id: null,
      }));
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId)!.handleRequest(req, res);
    } else if (!sessionId && req.method === "POST") {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });
      const server = createMcpServer();

      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
        logger.info("Session closed", { sessionId: transport.sessionId });
      };

      await server.connect(transport);
      await transport.handleRequest(req, res);

      if (transport.sessionId) {
        sessions.set(transport.sessionId, transport);
        logger.info("New session", { sessionId: transport.sessionId });
      }
    } else if (sessionId && !sessions.has(sessionId)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Session not found. POST an initialize request without mcp-session-id to start a new session." }, id: null }));
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message: "Missing mcp-session-id header. POST an initialize request first to obtain a session." }, id: null }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error: "Not found",
    endpoints: { mcp: `${baseHref}/mcp`, health: `${baseHref}/health`, warm: `${baseHref}/admin/warm` },
  }));
}

// Default export for Vercel serverless
export default handleRequest;

// ── Standalone server (stdio / HTTP) — only when invoked as a script ──────────

const isScript = process.argv[1] === fileURLToPath(import.meta.url);

if (isScript) {
  const args = process.argv.slice(2);
  const httpFlagIndex = args.indexOf("--http");
  const isHttpMode = httpFlagIndex !== -1;
  const httpPort = isHttpMode
    ? parseInt(args[httpFlagIndex + 1] || String(config.httpPort), 10)
    : config.httpPort;

  function startWarmer() {
    if (config.cacheWarmingEnabled) {
      warmer.start();
      process.on("SIGTERM", () => warmer.stop());
      process.on("SIGINT",  () => warmer.stop());
    } else {
      logger.info("Cache warming disabled (CACHE_WARMING_ENABLED=false)");
    }
  }

  async function startStdio() {
    const server = createMcpServer();
    logger.info("Starting CC Financial Markets MCP server (stdio)", { baseUrl: config.baseUrl, redis: redis.enabled });
    startWarmer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Server connected via stdio transport");
  }

  async function startHttp() {
    const httpServer = createServer(handleRequest);
    httpServer.listen(httpPort, () => {
      logger.info(`CC Financial Markets MCP server (HTTP) running`, { port: httpPort, redis: redis.enabled });
      process.stderr.write(`\n🌍 CC Financial Markets MCP Server\n`);
      process.stderr.write(`   MCP endpoint:   http://localhost:${httpPort}/mcp\n`);
      process.stderr.write(`   Health check:   http://localhost:${httpPort}/health\n`);
      process.stderr.write(`   Warm endpoint:  http://localhost:${httpPort}/admin/warm\n`);
      process.stderr.write(`   Redis:          ${redis.enabled ? "enabled" : "disabled"}\n\n`);
    });
    if (config.mcpApiKeys.length === 0) {
      logger.warn("MCP endpoint unauthenticated — set MCP_API_KEYS to enable Bearer auth");
    }
    startWarmer();
  }

  const main = isHttpMode ? startHttp : startStdio;
  main().catch((error) => {
    logger.error("Fatal error", { error: String(error) });
    process.exit(1);
  });
}
