# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`cc-financial-markets-mcp` — MCP (Model Context Protocol) server that scrapes and serves African stock market data from african-markets.com. It exposes 5 tools over stdio JSON-RPC: `list_exchanges`, `get_market_data`, `get_annual_reports`, `get_market_news`, `get_company_profile`.

## Commands

```bash
npm run build          # Compile TypeScript → dist/
npm run dev            # Watch mode with tsx (auto-reload)
npm run start          # Run compiled server (requires build first)
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode tests
npm run test:single -- "parseNumber"  # Run tests matching a name
npm run test:coverage  # Run with V8 coverage report
npm run typecheck      # Type-check without emitting
npm run lint           # ESLint on src/
npm run lint:fix       # ESLint with auto-fix
npm run inspect        # Launch MCP Inspector UI for manual tool testing
```

Docker:
```bash
docker build -t cc-financial-markets-mcp .
docker run --rm -i cc-financial-markets-mcp
```

Manual JSON-RPC test:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_market_data","arguments":{"exchange":"BRVM","type":"movers"}}}' | node dist/index.js
```

## Architecture

```
src/
├── index.ts              # Entry point — creates McpServer, registers 4 tools, connects stdio transport
├── config.ts             # Env-based config (base URL, cache TTL, rate limit, log level)
├── logger.ts             # Structured JSON logger → stderr (stdout reserved for MCP JSON-RPC)
├── types/markets.ts      # Domain types + AFRICAN_EXCHANGES constant (17 exchanges with URL slugs)
├── cache/cache.ts        # In-memory TTL cache (Map-based, no external deps)
├── scraper/
│   ├── rate-limiter.ts   # Token-bucket rate limiter (requests/minute)
│   ├── fetcher.ts        # HTTP fetcher with rate-limiting, retries, and cache integration (native fetch)
│   └── parser.ts         # Cheerio-based HTML parsers tuned to african-markets.com's real DOM structure
└── tools/
    ├── list-exchanges.ts   # Pure function, no scraping — returns AFRICAN_EXCHANGES filtered by country
    ├── market-data.ts      # Scrapes listed-companies + exchange page → stocks, movers, indices
    ├── annual-reports.ts   # Scrapes publications page (edocman) → reports with download URLs
    └── market-news.ts      # Scrapes homepage raxo articles → news with dates and exchange tags
```

### Data Flow

1. MCP client sends a tool call via stdio
2. `index.ts` dispatches to the matching tool handler in `tools/`
3. Tool handler calls `Fetcher.fetchPage(path)` which checks cache → rate limiter → HTTP fetch → cache store
4. Raw HTML is passed to the appropriate `parser.ts` function (cheerio) → typed domain objects
5. Result is JSON-serialized back as MCP tool response

### african-markets.com Site Structure (Joomla CMS)

The site uses these URL patterns (all under `/fr`):
- `/bourse/{slug}` — exchange overview (movers + indices)
- `/bourse/{slug}/listed-companies` — full stock listing table
- `/bourse/{slug}/publications?layout=table` — edocman documents (reports, notations)
- `/` (homepage) — news articles via Raxo AllMode Pro module

Exchange slugs are: `jse`, `bse`, `brvm`, `egx`, `gse`, `nse`, `mse`, `bvc`, `sem`, `nsx`, `ngse`, `use`, `rse`, `dse`, `bvmt`, `luse`, `zse`.

Key CSS selectors in the DOM:
- `table[class^='tabtable-']` — all data tables (stocks, movers, indices)
- `table[class*='tabtable-rs_y3dom0sl']` — top gainers / losers / most active (3 separate tables, 5 rows each)
- `table[class*='tabtable-rs_m316x72x']` — global indices table (17 rows, one per exchange)
- `table.edocman_document_list` — publications table
- `.edocman_document_link` — document title+link inside publications
- `article.raxo-item-top`, `article.raxo-item-nor` — news articles on homepage

Not all exchanges have the same table format. BRVM has full pricing data (7 columns: Company|Sector|Price|1D|YTD|MCap|Date). Others like NSE Kenya only have 2 columns (Company|Sector) with no price data on the listing page.

### Key Design Decisions

- **Stdout is sacred**: All logging goes to stderr. Stdout is exclusively for MCP JSON-RPC messages.
- **Browser-like User-Agent**: The site is behind Cloudflare; a bare UA gets 403. The fetcher uses a full browser UA string.
- **No database**: All data is ephemeral — fetched on demand with in-memory TTL cache. Cache TTL defaults to 5min for market data, 1h for annual reports.
- **Rate limiter is shared**: Single `RateLimiter` instance across all tools to respect african-markets.com limits.
- **Parsers are fragile by nature**: The site's HTML structure may change. Parser functions use specific CSS class selectors discovered by scraping the live site. When scraping breaks, inspect the live DOM and update selectors in `parser.ts`.
- **French locale**: The site is scraped via `/fr` prefix. Number parsing handles French format (1 234,56).

### Adding a New Tool

1. Create `src/tools/my-tool.ts` with a Zod schema and async handler function
2. Register it in `src/index.ts` via `server.tool(name, description, schema.shape, handler)`
3. Add tests in `src/tools/my-tool.test.ts`

### Exchange Codes

The `AFRICAN_EXCHANGES` array in `types/markets.ts` is the source of truth for supported exchanges. The `url` field is the slug used in `/fr/bourse/{slug}`. To add an exchange, add it there with the correct slug from the site's navigation menu.

## Environment Variables

Configured via `.env` (see `.env.example`):
- `AFRICAN_MARKETS_BASE_URL` — scraping target (default: `https://www.african-markets.com/fr`)
- `CACHE_TTL_SECONDS` — default cache TTL (default: 300)
- `RATE_LIMIT_REQUESTS_PER_MINUTE` — rate limiter ceiling (default: 30)
- `LOG_LEVEL` — debug | info | warn | error (default: info)
