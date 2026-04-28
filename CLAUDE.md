# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`cc-financial-markets-mcp` — MCP (Model Context Protocol) server exposing 9 tools for African stock market data scraped from african-markets.com (and directly from SGBV for Algeria). Supports two transport modes: **stdio** (Claude Desktop / Claude Code) and **HTTP** (remote apps via StreamableHTTP).

## Commands

```bash
npm run build          # Compile TypeScript → dist/
npm run dev            # Watch mode with tsx (auto-reload)
npm test               # Unit tests (vitest, src/**/*.test.ts)
npm run test:watch     # Watch mode
npm run test:single -- "parseNumber"  # Run tests matching a name
npm run test:coverage  # V8 coverage report
npm run test:integration  # Integration tests against a real HTTP server (requires build first)
npm run test:all       # Unit + integration
npm run typecheck      # Type-check without emitting
npm run lint           # ESLint on src/
npm run lint:fix       # ESLint with auto-fix
npm run inspect        # Launch MCP Inspector UI for manual tool testing
```

Manual JSON-RPC test (stdio):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_market_data","arguments":{"exchange":"BRVM","type":"movers"}}}' | node dist/index.js
```

HTTP mode:
```bash
node dist/index.js --http 3100   # Start HTTP server on port 3100
```

## Architecture

```
src/
├── index.ts                    # Entry point — registers 9 MCP tools, handleRequest (HTTP), startHttp/startStdio
├── config.ts                   # All env vars → Config interface (single source of truth)
├── logger.ts                   # Structured JSON logger → stderr only (stdout = MCP JSON-RPC)
├── auth-mcp.ts                 # isAuthorizedMcp() Bearer token check + resolveOrigin() CORS
├── http-logger.ts              # generateRequestId() + logRequest() — per-request access log
├── inbound-rate-limiter.ts     # InboundRateLimiter — per-key sliding window, 429/Retry-After
├── types/markets.ts            # Domain types + AFRICAN_EXCHANGES (20 exchanges with slugs/providers)
├── utils/market-hours.ts       # isMarketOpen(), getOpenExchanges() — timezone-aware trading hours
├── cache/
│   ├── cache.ts                # In-memory TTL cache (Map-based)
│   ├── redis-cache.ts          # RedisCache — L2 cache, disabled gracefully when REDIS_URL unset
│   └── warmer.ts               # CacheWarmer — background pre-fetch during market hours
├── scraper/
│   ├── interfaces.ts           # IMarketDataStrategy + MarketDataResult
│   ├── factory.ts              # ScraperFactory.getStrategy(provider, fetcher) — routes to strategy
│   ├── circuit-breaker.ts      # CircuitBreaker — CLOSED/OPEN/HALF_OPEN, wraps any async fn
│   ├── fetcher.ts              # HTTP fetcher: rate-limit → cache → circuit breaker → fetch → cache write
│   ├── rate-limiter.ts         # Token-bucket outbound rate limiter (african-markets.com)
│   ├── auth.ts                 # Cookie-based auth for premium pages
│   ├── parser.ts               # Cheerio parsers for african-markets.com DOM
│   ├── index-history-parser.ts # Parser for index OHLCV history pages
│   ├── stock-history-parser.ts # Parser for stock OHLCV history pages (premium)
│   └── strategies/
│       ├── african-markets.ts  # Default strategy — fetches via /bourse/{slug}
│       ├── sgbv.ts             # SGBV (Algeria) — live scraper via sgbv.dz 3-step pipeline
│       └── bvmac.ts            # BVMAC (CEMAC) — live scraper via bosxch.bvm-ac.org/ws_api (JSON + HTML fragments)
└── tools/                      # One file per MCP tool — Zod schema + async handler
    ├── list-exchanges.ts        # Pure — no scraping, filters AFRICAN_EXCHANGES
    ├── market-data.ts           # Stocks / movers / indices, Redis L2 cache with warm
    ├── annual-reports.ts        # Edocman publications (paginated)
    ├── company-documents.ts     # Full document list per company (premium)
    ├── market-news.ts           # Homepage raxo articles
    ├── company-profile.ts       # Company overview page (premium)
    ├── index-history.ts         # Index OHLCV history (since 2015)
    └── stock-history.ts         # Stock OHLCV history, filtered by period (premium)
```

## Data Flow

**HTTP mode** (remote clients):
1. Request → `handleRequest` → CORS + `x-request-id` + `res.on("finish")` access log
2. OPTIONS → 204 immediately. GET `/mcp` → public HTML landing page.
3. POST/DELETE → Bearer auth (`isAuthorizedMcp`) → inbound rate limit → MCP session routing
4. MCP tool call → tool handler → `Fetcher.fetchPage()` → Redis L2 hit or live scrape → result

**Cache strategy for `get_market_data`**:
- Redis L2 key: `mcp:market:{code}:all` — pre-warmed every 5 min during market hours
- On Redis miss: live scrape via `ScraperFactory.getStrategy(provider)` → writes back to Redis
- `/admin/warm` endpoint triggers `warmBatch()` — authenticated by `x-vercel-cron: 1` header or `?secret=MCP_ADMIN_SECRET`

**Stdio mode**: bypasses `handleRequest` entirely — direct MCP JSON-RPC over stdin/stdout.

## Multi-Provider Strategy Pattern

`AFRICAN_EXCHANGES` in `types/markets.ts` has a `provider` field (`"african-markets" | "sgbv" | "bvmac"`). `ScraperFactory.getStrategy(provider, fetcher)` routes to the correct `IMarketDataStrategy` implementation. All strategies must return `{ stocks?, movers?, indices? }` and never throw to callers — swallow errors internally, return empty arrays, log with `logger.warn`.

To add a new exchange provider:
1. Add entry to `AFRICAN_EXCHANGES` with correct `provider` value
2. Create `src/scraper/strategies/{name}.ts` implementing `IMarketDataStrategy`
3. Register in `ScraperFactory`

## HTTP Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /mcp` | None | HTML landing page (browser) |
| `POST /mcp` | Bearer (if `MCP_API_KEYS` set) | MCP protocol |
| `DELETE /mcp` | Bearer | Close MCP session |
| `GET /health` | None | Status + Redis + per-exchange freshness |
| `GET /admin/status` | `x-vercel-cron: 1` OR `?secret=` | Uptime, circuit breaker state, cache size, Redis flag |
| `POST /admin/warm` | `x-vercel-cron: 1` OR `?secret=` | Trigger cache warm |

## Integration Tests

`tests/integration/` — run against a real compiled server (`dist/index.js`). Require `npm run build` first.

- `setup.ts` — global setup/teardown, starts server on port **3099** with no auth
- `http-server.test.ts` — health, MCP protocol, CORS, x-request-id, /admin/warm
- `auth-mcp.test.ts` — starts its own server on port **3098** with `MCP_API_KEYS` + `MCP_ALLOWED_ORIGINS`
- `rate-limit.test.ts` — starts servers on ports **3097** / **3096** with low `MCP_INBOUND_RATE_LIMIT`
- `circuit-breaker.test.ts` — starts its own server on port **3095** with `AFRICAN_MARKETS_BASE_URL` pointing to 127.0.0.1:19999 (nothing listening → ECONNREFUSED), `CIRCUIT_BREAKER_THRESHOLD=2`, `CACHE_WARMING_ENABLED=false`, `REDIS_URL=""`

Each test file that needs custom env vars manages its own `ChildProcess` in `beforeAll`/`afterAll`.

## Environment Variables

All variables and their defaults are in `src/config.ts`. See `.env.example` for documentation. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AFRICAN_MARKETS_USERNAME` | — | Premium account (required for stock/company history) |
| `AFRICAN_MARKETS_PASSWORD` | — | Premium account password |
| `REDIS_URL` | — | Redis connection string; empty = in-memory only |
| `MCP_API_KEYS` | — | Comma-separated Bearer tokens; empty = auth disabled |
| `MCP_ALLOWED_ORIGINS` | — | CORS allowlist; empty = `*` |
| `MCP_INBOUND_RATE_LIMIT` | `60` | Requests/min per key on `/mcp`; `0` = disabled |
| `MCP_ADMIN_SECRET` | — | Secret for manual `/admin/warm` and `/admin/status` calls |
| `CACHE_WARMING_ENABLED` | `true` | Set `false` in serverless (Vercel handles it via Cron) |
| `CACHE_TTL_SECONDS` | `300` | Market data TTL |
| `CIRCUIT_BREAKER_THRESHOLD` | `3` | Consecutive failures before opening the circuit |
| `CIRCUIT_BREAKER_TIMEOUT_SECONDS` | `30` | Cooldown before HALF_OPEN probe attempt |

## Key Design Decisions

- **Stdout is sacred**: All logging → stderr. Stdout exclusively for MCP JSON-RPC.
- **Browser UA required**: african-markets.com is behind Cloudflare — bare UA returns 403.
- **Two rate limiters coexist**: `RateLimiter` (outbound, token-bucket) limits calls to african-markets.com. `InboundRateLimiter` (per-key sliding window) protects `/mcp` from client abuse.
- **Redis fail-open**: `RedisCache` disables itself gracefully when `REDIS_URL` is unset — all operations become no-ops returning `null`. Same for `acquireLock`/`releaseLock`.
- **Parsers are fragile**: CSS selectors in `parser.ts` are tuned to african-markets.com's live DOM (Joomla CMS). When scraping breaks, inspect the live DOM and update selectors.
- **French locale numbers**: `parseNumber` in `parser.ts` handles `1 234,56` → `1234.56`.
- **BRVM vs other exchanges**: BRVM has 7-column pricing data. Other exchanges like NSE Kenya only expose company names — no price data on the listing page.
- **Circuit breaker wraps the retry loop**: `CircuitBreaker.call(fn)` wraps the entire retry loop in `Fetcher.fetchPage()`. When the circuit is OPEN, it throws `CircuitOpenError` before any network call. This means `CacheWarmer` background calls also consume the failure budget — integration tests that test circuit behavior **must** set `CACHE_WARMING_ENABLED=false` to prevent race conditions.

## Adding a New Tool

1. Create `src/tools/my-tool.ts` — Zod schema export + async handler function
2. Register in `src/index.ts` via `server.tool(name, description, schema.shape, handler)`
3. Add tests in `src/tools/my-tool.test.ts`
