/**
 * SGBV (Bourse d'Alger / Société de Gestion de la Bourse des Valeurs) strategy.
 * Site: https://www.sgbv.dz — PHP-based with query-string routing.
 *
 * DOM research (2026-04-26):
 *   - PHP URL: https://www.sgbv.dz/?page=histo_boc&lang=fr
 *     Lists all BOC (Bulletin Officiel de la Cote) sessions.
 *     Each row has a "Détail" link: <a href="./?page=details_boc&id_sea=2982&lang=fr">Détail</a>
 *     We extract the max id_sea from these links to get the latest session.
 *
 *   - PHP URL: https://www.sgbv.dz/?page=details_boc&id_sea={MAX}&lang=fr
 *     Shows price data for the selected session.
 *     Table selector: table.table
 *     Columns: Titre | Cours DA | Volume transigé | Valeur transigée | Nombre de transactions
 *     Example row: <tr><td>BDL</td><td>1 398,00</td><td>29295</td><td>40 954 410,00</td><td>34</td></tr>
 *     Last row contains "Total" summary — must be skipped.
 *     Header row (first tr): <tr class="table_title"><th>Titre</th><th>Cours DA</th>...</tr>
 *
 *   - PHP URL: https://www.sgbv.dz/?page=ligne_societe&lang=fr
 *     Company master data table: Code ISIN | Code Bourse | Libellé Valeur | Secteur | Val. Nominale | Nb actions
 *     Used to map ticker → full company name.
 *
 * Known limitations:
 *   - No change/changePercent in the details table. The ticker carousel (div.carousel, hidden) has
 *     variation images (up.png/down.png) and values but is unreliable (display:none, fragile).
 *     Decision: set change=0, changePercent=0. Mark as known limitation.
 *   - Only ~6 listed securities — no dedicated movers page.
 *     For type="movers": derived from stock list (sort by volume).
 *   - Indices (AL30, ML30) always show 0 on the site. Return [].
 */

import * as cheerio from "cheerio";
import { logger } from "../../logger.js";
import type { StockQuote } from "../../types/markets.js";
import type { Fetcher } from "../fetcher.js";
import type { IMarketDataStrategy, MarketDataResult } from "../interfaces.js";
import type { MarketExchange } from "../../types/markets.js";
import { parseNumber } from "../parser.js";

const SGBV_BASE = "https://www.sgbv.dz";
// Default TTL of 5 minutes for market data (same as other strategies)
const CACHE_TTL_SEC = 300;

/**
 * Extract the maximum id_sea from the histo_boc page.
 * Links have the form: ./?page=details_boc&id_sea=2982&lang=fr
 */
function extractMaxSessionId(html: string): number | null {
  const $ = cheerio.load(html);
  let maxId: number | null = null;

  $("a[href*='page=details_boc']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/id_sea=(\d+)/);
    if (match) {
      const id = parseInt(match[1], 10);
      if (maxId === null || id > maxId) {
        maxId = id;
      }
    }
  });

  return maxId;
}

/**
 * Parse the details_boc page into StockQuote[].
 * Table: table.table
 * Columns: Titre | Cours DA | Volume transigé | Valeur transigée | Nombre de transactions
 */
function parseSgbvStocksTable(html: string, nameMap: Map<string, string>): StockQuote[] {
  const $ = cheerio.load(html);
  const quotes: StockQuote[] = [];

  // Extract session date from the page heading if available
  const today = new Date().toISOString().split("T")[0];

  $("table.table").each((_, table) => {
    const $table = $(table);

    $table.find("tr").each((rowIdx, row) => {
      if (rowIdx === 0) return; // skip header row

      const cells = $(row).find("td");
      if (cells.length < 2) return;

      const ticker = $(cells[0]).text().trim();
      if (!ticker) return;

      // Skip the "Total" summary row at the bottom
      if (ticker.toLowerCase().startsWith("total")) return;

      const priceText = cells.length > 1 ? $(cells[1]).text().trim() : "0";
      const volumeText = cells.length > 2 ? $(cells[2]).text().trim() : "0";

      const price = parseNumber(priceText);
      const volume = parseNumber(volumeText);

      // Full name from company master table, fallback to ticker
      const name = nameMap.get(ticker) ?? ticker;

      quotes.push({
        symbol: ticker,
        name,
        exchange: "SGBV",
        price,
        change: 0, // not available on the details page
        changePercent: 0, // not available on the details page
        volume: volume > 0 ? volume : undefined,
        date: today,
      });
    });
  });

  return quotes;
}

/**
 * Build a map of ticker → full company name from the ligne_societe page.
 * Table: table.table, first row is header.
 * Columns: Code ISIN | Code Bourse | Libellé Valeur | Secteur | Valeur Nominale | Nb actions
 * "Code Bourse" (col index 1) is the ticker used in the details table.
 */
function parseSgbvCompanyNames(html: string): Map<string, string> {
  const $ = cheerio.load(html);
  const nameMap = new Map<string, string>();

  $("table.table").each((_, table) => {
    $(table).find("tr").each((rowIdx, row) => {
      if (rowIdx === 0) return; // skip header

      const cells = $(row).find("td");
      if (cells.length < 3) return;

      const code = $(cells[1]).text().trim(); // Code Bourse
      const libelle = $(cells[2]).text().trim(); // Libellé Valeur
      if (code && libelle) {
        nameMap.set(code, libelle);
      }
    });
  });

  return nameMap;
}

/**
 * Derive movers from the stock list.
 * With only ~6 securities there is no dedicated movers page.
 * - mostActive: sorted by volume desc
 * - gainers / losers: empty (changePercent not available from SGBV)
 */
function deriveMovers(stocks: StockQuote[]) {
  const withVolume = [...stocks].filter((s) => (s.volume ?? 0) > 0);
  const mostActive = withVolume.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  return {
    gainers: [] as StockQuote[],
    losers: [] as StockQuote[],
    mostActive,
  };
}

export class SgbvStrategy implements IMarketDataStrategy {
  constructor(private fetcher: Fetcher) {}

  async getMarketData(
    exchange: MarketExchange,
    type: "stocks" | "movers" | "indices" | "all",
    forceRefresh: boolean
  ): Promise<MarketDataResult> {
    try {
      // Indices: AL30/ML30 always show 0 on the SGBV site — return empty
      if (type === "indices") {
        return { indices: [] };
      }

      // Step 1: fetch histo_boc page to find the latest session id
      const histoHtml = await this.fetcher.fetchPage(
        `${SGBV_BASE}/?page=histo_boc&lang=fr`,
        CACHE_TTL_SEC,
        forceRefresh
      );

      const maxId = extractMaxSessionId(histoHtml);
      if (maxId === null) {
        logger.warn("SGBV: could not find any session id in histo_boc page");
        return { stocks: [], movers: { gainers: [], losers: [], mostActive: [] }, indices: [] };
      }

      logger.debug("SGBV: latest session id", { id_sea: maxId });

      // Step 2: fetch company names (cached for longer — structure rarely changes)
      const namesHtml = await this.fetcher.fetchPage(
        `${SGBV_BASE}/?page=ligne_societe&lang=fr`,
        3600 // 1-hour TTL for static master data
      );
      const nameMap = parseSgbvCompanyNames(namesHtml);

      // Step 3: fetch the latest session details
      const detailsHtml = await this.fetcher.fetchPage(
        `${SGBV_BASE}/?page=details_boc&id_sea=${maxId}&lang=fr`,
        CACHE_TTL_SEC,
        forceRefresh
      );

      const stocks = parseSgbvStocksTable(detailsHtml, nameMap);
      logger.info("SGBV: parsed stocks", { count: stocks.length, id_sea: maxId });

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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("SGBV: getMarketData failed", { exchange: exchange.code, type, error: message });
      return { stocks: [], movers: { gainers: [], losers: [], mostActive: [] }, indices: [] };
    }
  }
}
