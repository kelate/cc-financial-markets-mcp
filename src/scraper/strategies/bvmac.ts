/**
 * BVMAC (Bourse des Valeurs Mobilières de l'Afrique Centrale) strategy.
 * Site: https://www.bvm-ac.org — WordPress + Elementor.
 *
 * DOM research findings (2026-04-26):
 *
 *   - Main URL for equities: https://www.bvm-ac.org/tendances-du-marche-actions/
 *     The page HTML contains NO data tables. Market data is loaded entirely via
 *     jQuery AJAX calls at runtime from a separate API subdomain.
 *
 *   - API subdomain discovered in page JavaScript:
 *       https://bosxch.bvm-ac.org/ws_api/
 *     DNS resolution: SERVFAIL — the subdomain is not publicly reachable.
 *     Cannot implement a live scraper without access to the API response structure.
 *
 *   - BOC (Bulletin Officiel de la Cote) PDFs are publicly available at:
 *       https://www.bvm-ac.org/wp-content/uploads/{YYYY}/{MM}/BOC-{YYYYMMDD}.pdf
 *     Example: https://www.bvm-ac.org/wp-content/uploads/2025/01/BOC-20250131.pdf
 *     These PDFs could be parsed with pdf-parse or pdfjs-dist in a future iteration,
 *     but that is out of scope for the current sprint.
 *
 *   - Alternative: the "Sociétés Cotées" page at https://www.bvm-ac.org/societes-cotees/
 *     has company profile cards (name, sector, ISIN) but no live price data.
 *
 * Decision:
 *   Return empty results with a structured log warning. This is the correct behaviour
 *   when the upstream data source is unavailable — callers get a well-typed empty
 *   result rather than a crash, and the warning is visible in structured logs.
 *
 *   To implement live data once bosxch.bvm-ac.org becomes accessible:
 *   1. Inspect the /ws_api/ response structure (likely JSON with tickers + prices)
 *   2. Call `this.fetcher.fetchPage("https://bosxch.bvm-ac.org/ws_api/...", CACHE_TTL_SEC)`
 *   3. JSON.parse the response and map to StockQuote[]
 *   4. Remove this stub and replace with the real implementation
 */

import { logger } from "../../logger.js";
import type { MarketExchange } from "../../types/markets.js";
import type { Fetcher } from "../fetcher.js";
import type { IMarketDataStrategy, MarketDataResult } from "../interfaces.js";

const BVMAC_API_SUBDOMAIN = "https://bosxch.bvm-ac.org/ws_api/";

export class BvmacStrategy implements IMarketDataStrategy {
  // Fetcher retained for future implementation when the API becomes accessible
  constructor(private fetcher: Fetcher) {}

  async getMarketData(
    exchange: MarketExchange,
    type: "stocks" | "movers" | "indices" | "all",
    _forceRefresh: boolean
  ): Promise<MarketDataResult> {
    logger.warn("BVMAC: market data unavailable — API subdomain not accessible", {
      exchange: exchange.code,
      type,
      reason: `${BVMAC_API_SUBDOMAIN} resolves with DNS SERVFAIL`,
      note: "Data is AJAX-loaded at runtime; no static HTML tables present on the page.",
    });

    const empty = { gainers: [], losers: [], mostActive: [] };

    switch (type) {
      case "stocks":
        return { stocks: [] };
      case "movers":
        return { movers: empty };
      case "indices":
        return { indices: [] };
      case "all":
      default:
        return { stocks: [], movers: empty, indices: [] };
    }
  }
}
