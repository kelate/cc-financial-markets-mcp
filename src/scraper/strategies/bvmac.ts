/**
 * BVMAC (Bourse des Valeurs Mobilières de l'Afrique Centrale) strategy.
 *
 * Investigation (2026-04-26):
 *
 *   Public website: https://www.bvm-ac.org (WordPress + Elementor)
 *     - /tendances-du-marche-actions/  → 200 OK, no inline data, AJAX-only
 *     - /espace-emetteurs/societes-cotees-a-la-bvmac/  → 200 OK, company profiles only
 *     - bvmac.org / www.bvmac.org  → ECONNREFUSED (dead)
 *
 *   Live data API: https://bosxch.bvm-ac.org/ws_api/
 *     - DNS resolves publicly to 51.91.247.161 (OVH FR). Some local resolvers
 *       (split DNS / Tailscale) may return SERVFAIL — verify against 8.8.8.8 if so.
 *     - GET / → 200 OK, application/json, ~26 KB
 *     - Response shape: { action, obligation, capitalisation, stykerbar, datecapitalisation }
 *       Each value is a server-rendered HTML fragment (UTF-8).
 *
 *   `action` fragment structure (the one we consume):
 *     <table class="table"><thead>...</thead><tbody>
 *       <tr>
 *         <th>{ISIN}</th>             ← e.g. CM0000010009
 *         <td>{ACTION <name>}</td>    ← e.g. "ACTION SEMC", "ACTIONS SCG-Ré"
 *         <td>{lastDividendDate}</td> ← yyyy-mm-dd
 *         <td>{lastDividendValue}</td>
 *         <td>{nominal}</td>
 *         <td>{referencePrice}</td>   ← FR-formatted, e.g. "50 000"
 *         <td>{closePrice}</td>       ← FR-formatted; canonical price field
 *         <td>{askedVolume}</td>
 *         <td>{offeredVolume}</td>
 *         <td>{tradedVolume}</td>     ← used for `volume`
 *         <td>{variationPct}</td>     ← FR-formatted, e.g. "0,00"
 *         <td>{marketStatus}</td>     ← NC | PEq | etc.
 *       </tr>
 *     </tbody></table>
 *
 *   `datecapitalisation` fragment: "SEANCE DE COTATION : Vendredi 24 Avril 2026".
 *   We parse the day/month/year into ISO format for StockQuote.date.
 *
 * Decisions:
 *   - Only equities are surfaced (StockQuote schema targets stocks).
 *     The `obligation` fragment (EOG.* bonds) and `stykerbar` ticker are intentionally ignored.
 *   - Indices return [] : BVMAC publishes only an aggregate market-cap figure
 *     under `capitalisation`, not a stock index value.
 *   - Movers are derived from the stock list (no dedicated movers endpoint exists).
 *   - On any error (network, JSON, missing key), log a warning and return a
 *     well-typed empty result for the requested type — never throw to the caller.
 */

import * as cheerio from "cheerio";
import { logger } from "../../logger.js";
import { parseNumber } from "../parser.js";
import type { StockQuote } from "../../types/markets.js";
import type { Fetcher } from "../fetcher.js";
import type { IMarketDataStrategy, MarketDataResult } from "../interfaces.js";
import type { MarketExchange } from "../../types/markets.js";

const BVMAC_API_URL = "https://bosxch.bvm-ac.org/ws_api/";
const CACHE_TTL_SEC = 300;

interface BvmacApiResponse {
  action?: string;
  obligation?: string;
  capitalisation?: string;
  stykerbar?: string;
  datecapitalisation?: string;
}

const FRENCH_MONTHS: Record<string, number> = {
  janvier: 1, "février": 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, "août": 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, "décembre": 12, decembre: 12,
};

/** Parse "Vendredi 24 Avril 2026" into ISO "2026-04-24". Returns null if unparseable. */
export function parseFrenchDate(text: string): string | null {
  const match = text.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = FRENCH_MONTHS[match[2].toLowerCase()];
  const year = parseInt(match[3], 10);
  if (!month || !day || !year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Extract the trading session date from the `datecapitalisation` HTML fragment. */
export function extractSessionDate(datecapitalisationHtml: string): string {
  const $ = cheerio.load(datecapitalisationHtml);
  const text = $("p.seance").text() || $.root().text();
  return parseFrenchDate(text) ?? new Date().toISOString().split("T")[0];
}

/**
 * Parse the `action` HTML fragment into StockQuote[].
 * Structure documented in the file header.
 */
export function parseBvmacStocksHtml(html: string, sessionDate: string): StockQuote[] {
  const $ = cheerio.load(html);
  const quotes: StockQuote[] = [];

  $("#action-market table.table tbody tr").each((_, row) => {
    const $row = $(row);
    const isin = $row.find("th").first().text().trim();
    const cells = $row.find("td");
    if (!isin || cells.length < 11) return;

    const fixingLabel = $(cells[0]).text().trim(); // "ACTION SEMC" / "ACTIONS SCG-Ré"
    const symbol = fixingLabel.replace(/^ACTIONS?\s+/i, "").trim();
    if (!symbol) return;

    const referencePrice = parseNumber($(cells[4]).text());
    const closePrice = parseNumber($(cells[5]).text());
    const tradedVolume = parseNumber($(cells[8]).text());
    const variationPct = parseNumber($(cells[9]).text());

    // Use close price when published (>0), otherwise fall back to reference price.
    const price = closePrice > 0 ? closePrice : referencePrice;

    // Compute absolute change from the variation %, rounded to whole XAF
    // (BVMAC equities trade in whole-FCFA increments).
    const change = price && variationPct ? Math.round((price * variationPct) / 100) : 0;

    quotes.push({
      symbol,
      name: fixingLabel,
      exchange: "BVMAC",
      price,
      change,
      changePercent: variationPct,
      volume: tradedVolume > 0 ? tradedVolume : undefined,
      date: sessionDate,
    });
  });

  return quotes;
}

function deriveMovers(stocks: StockQuote[]): {
  gainers: StockQuote[];
  losers: StockQuote[];
  mostActive: StockQuote[];
} {
  const gainers = stocks
    .filter((s) => s.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent);
  const losers = stocks
    .filter((s) => s.changePercent < 0)
    .sort((a, b) => a.changePercent - b.changePercent);
  const mostActive = stocks
    .filter((s) => (s.volume ?? 0) > 0)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  return { gainers, losers, mostActive };
}

function emptyResult(type: "stocks" | "movers" | "indices" | "all"): MarketDataResult {
  const empty = { gainers: [], losers: [], mostActive: [] };
  switch (type) {
    case "stocks": return { stocks: [] };
    case "movers": return { movers: empty };
    case "indices": return { indices: [] };
    case "all":
    default: return { stocks: [], movers: empty, indices: [] };
  }
}

export class BvmacStrategy implements IMarketDataStrategy {
  constructor(private fetcher: Fetcher) {}

  async getMarketData(
    exchange: MarketExchange,
    type: "stocks" | "movers" | "indices" | "all",
    forceRefresh: boolean
  ): Promise<MarketDataResult> {
    // Indices: BVMAC does not publish a stock index — only an aggregate market-cap.
    if (type === "indices") {
      return { indices: [] };
    }

    let payload: BvmacApiResponse;
    try {
      const raw = await this.fetcher.fetchPage(BVMAC_API_URL, CACHE_TTL_SEC, forceRefresh);
      payload = JSON.parse(raw) as BvmacApiResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("BVMAC: failed to fetch or parse ws_api payload", {
        exchange: exchange.code,
        type,
        url: BVMAC_API_URL,
        error: message,
      });
      return emptyResult(type);
    }

    if (!payload.action) {
      logger.warn("BVMAC: ws_api payload missing 'action' fragment", {
        exchange: exchange.code,
        type,
        keys: Object.keys(payload),
      });
      return emptyResult(type);
    }

    let stocks: StockQuote[];
    try {
      const sessionDate = payload.datecapitalisation
        ? extractSessionDate(payload.datecapitalisation)
        : new Date().toISOString().split("T")[0];
      stocks = parseBvmacStocksHtml(payload.action, sessionDate);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("BVMAC: failed to parse action fragment", {
        exchange: exchange.code,
        type,
        error: message,
      });
      return emptyResult(type);
    }

    logger.info("BVMAC: parsed stocks", { count: stocks.length, type });

    const result: MarketDataResult = {};

    if (type === "stocks" || type === "all") {
      result.stocks = stocks;
    }
    if (type === "movers" || type === "all") {
      result.movers = deriveMovers(stocks);
    }
    if (type === "all") {
      result.indices = [];
    }

    return result;
  }
}
