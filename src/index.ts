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
 */

import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Cache } from "./cache/cache.js";
import { CacheWarmer } from "./cache/warmer.js";
import { loadConfig } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { Fetcher } from "./scraper/fetcher.js";
import { RateLimiter } from "./scraper/rate-limiter.js";
import { GetAnnualReportsSchema, getAnnualReports } from "./tools/annual-reports.js";
import { GetCompanyProfileSchema, getCompanyProfile } from "./tools/company-profile.js";
import { ListExchangesSchema, listExchanges } from "./tools/list-exchanges.js";
import { GetMarketDataSchema, getMarketData } from "./tools/market-data.js";
import { GetMarketNewsSchema, getMarketNews } from "./tools/market-news.js";
import { GetIndexHistorySchema, getIndexHistory } from "./tools/index-history.js";
import { GetStockHistorySchema, getStockHistory } from "./tools/stock-history.js";

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

const warmer = new CacheWarmer(fetcher);

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "cc-financial-markets",
    version: "0.1.0",
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
        const result = await getMarketData(params, fetcher);
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

// --- HTTP request handler (shared between standalone server and Vercel export) ---

// Sessions persist within a process instance (warm Lambda re-use benefits from this)
const sessions = new Map<string, StreamableHTTPServerTransport>();

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = req.headers.host || "localhost";
  const protocol = "https";
  const baseHref = `${protocol}://${host}`;
  const url = new URL(req.url || "/", baseHref);

  // CORS headers for external app access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/mcp") {
    const accept = req.headers.accept || "";
    // Browser/non-MCP client hitting /mcp without SSE accept → show info page
    if (req.method === "GET" && !accept.includes("text/event-stream")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>CC Financial Markets MCP</title>
<style>body{font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#1a1a1a}
h1{color:#d35400}code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:0.9em}
pre{background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;overflow-x:auto;font-size:0.85em}
.status{display:inline-block;background:#27ae60;color:#fff;padding:4px 12px;border-radius:12px;font-size:0.85em}</style>
</head>
<body>
<h1>🌍 CC Financial Markets MCP Server</h1>
<p><span class="status">● En ligne</span></p>
<p>Ce serveur expose des données boursières africaines via le protocole <strong>MCP (Model Context Protocol)</strong>.</p>

<h2>Outils disponibles</h2>
<ul>
<li><code>list_exchanges</code> — 17 places de marché africaines</li>
<li><code>get_market_data</code> — cours, movers, indices en temps réel</li>
<li><code>get_annual_reports</code> — rapports et publications PDF</li>
<li><code>get_market_news</code> — actualités financières</li>
<li><code>get_index_history</code> — historique de l'indice (close/volume, depuis 2015)</li>
<li><code>get_stock_history</code> — historique OHLCV d'une action (premium)</li>
</ul>

<h2>Connexion depuis une app</h2>
<p>Endpoint MCP : <code>${baseHref}/mcp</code></p>
<pre>
// 1. Initialiser la session
POST ${baseHref}/mcp
Headers: Content-Type: application/json
         Accept: application/json, text/event-stream

Body: {
  "jsonrpc": "2.0", "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "mon-app", "version": "1.0" }
  }
}

// 2. Appeler un outil (avec le mcp-session-id reçu)
POST ${baseHref}/mcp
Headers: Content-Type: application/json
         Accept: application/json, text/event-stream
         mcp-session-id: &lt;SESSION_ID&gt;

Body: {
  "jsonrpc": "2.0", "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_market_data",
    "arguments": { "exchange": "BRVM", "type": "movers" }
  }
}
</pre>

<h2>Health check</h2>
<p><a href="/health"><code>GET /health</code></a></p>
</body></html>`);
      return;
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session — route to its transport (POST, GET SSE, DELETE)
      await sessions.get(sessionId)!.handleRequest(req, res);
    } else if (!sessionId && req.method === "POST") {
      // New session — create transport + server pair
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
      // Session expired or unknown
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Session not found. Send an initialize request without mcp-session-id to start a new session." }, id: null }));
    } else {
      // GET/DELETE without session-id → bad request
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message: "Missing mcp-session-id header. POST an initialize request first to obtain a session." }, id: null }));
    }
  } else if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      server: "cc-financial-markets-mcp",
      version: "0.1.0",
      cacheWarmer: config.cacheWarmingEnabled ? warmer.stats : { enabled: false },
    }));
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: "Not found",
      endpoints: { mcp: `${baseHref}/mcp`, health: `${baseHref}/health` },
    }));
  }
}

// Default export for Vercel serverless — runtime calls handler(req, res) per request
export default handleRequest;

// --- Standalone server (stdio / HTTP) — only runs when invoked as a script ---

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
      // Graceful shutdown
      process.on("SIGTERM", () => warmer.stop());
      process.on("SIGINT",  () => warmer.stop());
    } else {
      logger.info("Cache warming disabled (CACHE_WARMING_ENABLED=false)");
    }
  }

  async function startStdio() {
    const server = createMcpServer();
    logger.info("Starting CC Financial Markets MCP server (stdio)", { baseUrl: config.baseUrl });
    startWarmer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Server connected via stdio transport");
  }

  async function startHttp() {
    const httpServer = createServer(handleRequest);
    httpServer.listen(httpPort, () => {
      logger.info(`CC Financial Markets MCP server (HTTP) running`, { port: httpPort });
      process.stderr.write(`\n🌍 CC Financial Markets MCP Server\n`);
      process.stderr.write(`   MCP endpoint: http://localhost:${httpPort}/mcp\n`);
      process.stderr.write(`   Health check: http://localhost:${httpPort}/health\n\n`);
    });
    startWarmer();
  }

  const main = isHttpMode ? startHttp : startStdio;
  main().catch((error) => {
    logger.error("Fatal error", { error: String(error) });
    process.exit(1);
  });
}
