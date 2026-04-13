/**
 * HTML parsers for african-markets.com pages.
 * Uses cheerio to extract structured data from the scraped HTML.
 *
 * The site is a Joomla CMS using:
 * - `table[class^=tabtable-]` for market data tables
 * - `table.edocman_document_list` / `.edocman_document_link` for publications
 * - `article.raxo-item-top` / `article.raxo-item-nor` for news articles
 *
 * Table structure on /fr/bourse/{exchange}/listed-companies:
 *   Columns: Company | Sector | Price | 1D | YTD | M.Cap | Date
 *
 * Top gainers/losers tables (class tabtable-rs_y3dom0sl):
 *   Columns: Company | Price | Change% | Date
 *
 * Most active table (same class):
 *   Columns: Company | Price | Volume | Date
 *
 * Indices table (class tabtable-rs_m316x72x):
 *   Columns: (icon) | Name | Value | Change% | Date
 */

import * as cheerio from "cheerio";
import type { AnnualReport, MarketIndex, MarketNews, StockQuote } from "../types/markets.js";

/**
 * Parse the listed-companies page to extract full stock quotes.
 * URL pattern: /fr/bourse/{slug}/listed-companies
 * First table on the page has: Company | Sector | Price | 1D | YTD | M.Cap | Date
 */
export function parseStockTable(html: string, exchange: string): StockQuote[] {
  const $ = cheerio.load(html);
  const quotes: StockQuote[] = [];

  // The main listing table is the first tabtable with 7-column rows (Company|Sector|Price|1D|YTD|MCap|Date)
  $("table[class^='tabtable-']").each((_, table) => {
    const $table = $(table);
    const rows = $table.find("tr");
    // Check if this is the companies table by looking at header row
    const headerText = rows.first().text().toLowerCase();
    const isCompanyTable = headerText.includes("company") || headerText.includes("sector") || headerText.includes("price");

    if (!isCompanyTable && rows.length < 10) return; // Skip small sidebar tables

    // Detect table format by column count in first data row
    const sampleCells = rows.eq(1).find("td").length;

    rows.each((rowIdx, row) => {
      if (rowIdx === 0) return; // skip header
      const cells = $(row).find("td");
      if (cells.length < 2) return;

      // Extract symbol from the company link
      const companyLink = $(cells[0]).find("a").attr("href") || "";
      const symbolMatch = companyLink.match(/[?&]code=([A-Z0-9]+)/i);
      const name = $(cells[0]).text().trim();
      const symbol = symbolMatch ? symbolMatch[1] : name.split(/\s+/)[0].toUpperCase().slice(0, 8);
      if (!name) return;

      if (sampleCells >= 6) {
        // Full format: Company | Sector | Price | 1D | YTD | M.Cap | Date
        const price = parseNumber($(cells[2]).text().trim());
        if (price === 0) return;

        quotes.push({
          symbol,
          name,
          exchange,
          price,
          change: 0,
          changePercent: parseNumber($(cells[3]).text().trim()),
          volume: undefined,
          marketCap: parseNumber($(cells[5]).text().trim()),
          date: cells.length > 6 ? $(cells[6]).text().trim() : new Date().toISOString().split("T")[0],
        });
      } else {
        // Minimal format: Company | Sector (no price data — some exchanges)
        quotes.push({
          symbol,
          name,
          exchange,
          price: 0,
          change: 0,
          changePercent: 0,
          date: new Date().toISOString().split("T")[0],
        });
      }
    });

    if (quotes.length > 0) return false; // stop after first matching table
  });

  return quotes;
}

/**
 * Parse top gainers, losers, and most active from an exchange page.
 * These are 5-row tables with class tabtable-rs_y3dom0sl.
 * Columns: Company | Price | Change%_or_Volume | Date
 */
export function parseMovers(html: string, exchange: string): {
  gainers: StockQuote[];
  losers: StockQuote[];
  mostActive: StockQuote[];
} {
  const $ = cheerio.load(html);
  const tables: StockQuote[][] = [];

  $("table[class*='tabtable-rs_y3dom0sl']").each((_, table) => {
    const stocks: StockQuote[] = [];
    $(table).find("tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 3) return;

      const name = $(cells[0]).text().trim();
      const col2 = $(cells[1]).text().trim();
      const col3 = $(cells[2]).text().trim();
      const dateText = cells.length > 3 ? $(cells[3]).text().trim() : "";

      const companyLink = $(cells[0]).find("a").attr("href") || "";
      const symbolMatch = companyLink.match(/[?&]code=([A-Z0-9]+)/);
      const symbol = symbolMatch ? symbolMatch[1] : name.split(/\s+/)[0].toUpperCase().slice(0, 8);

      const price = parseNumber(col2);
      const isPercent = col3.includes("%");

      stocks.push({
        symbol,
        name,
        exchange,
        price,
        change: 0,
        changePercent: isPercent ? parseNumber(col3) : 0,
        volume: !isPercent ? parseNumber(col3) : undefined,
        date: dateText || new Date().toISOString().split("T")[0],
      });
    });
    tables.push(stocks);
  });

  return {
    gainers: tables[0] || [],
    losers: tables[1] || [],
    mostActive: tables[2] || [],
  };
}

/**
 * Parse market indices table from any exchange page.
 * Table class: tabtable-rs_m316x72x
 * Columns: (icon cell) | Name | Value | Change% | Date
 * The icon cell is empty text, actual index name is in the 2nd td.
 */
export function parseMarketIndices(html: string): MarketIndex[] {
  const $ = cheerio.load(html);
  const indices: MarketIndex[] = [];

  $("table[class*='tabtable-rs_m316x72x']").each((_, table) => {
    $(table).find("tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 4) return;

      // First cell is icon/flag, second is name with link
      const name = $(cells[1]).text().trim();
      const valueText = $(cells[2]).text().trim();
      const changePctText = $(cells[3]).text().trim();
      const dateText = cells.length > 4 ? $(cells[4]).text().trim() : "";

      const value = parseNumber(valueText);
      if (!name || value === 0) return;

      // Extract exchange code from link
      const link = $(cells[1]).find("a").attr("href") || "";
      const exchangeMatch = link.match(/\/bourse\/([a-z]+)/);
      const exchangeCode = exchangeMatch ? exchangeMatch[1].toUpperCase() : extractExchangeFromName(name);

      indices.push({
        name,
        exchange: exchangeCode,
        value,
        change: 0,
        changePercent: parseNumber(changePctText),
        date: dateText || new Date().toISOString().split("T")[0],
      });
    });
  });

  return indices;
}

/**
 * Parse publications (annual reports, financial docs) from edocman.
 * URL pattern: /fr/bourse/{slug}/publications?layout=table
 * Uses table.edocman_document_list or table.table-document
 *
 * Returns enriched reports with documentType and date, plus totalPages from pagination.
 * Date format on the site: MM-DD-YYYY (e.g. "02-03-2026") — normalised to "YYYY-MM-DD".
 */
export function parsePublications(
  html: string,
  exchange: string
): { reports: AnnualReport[]; totalPages: number } {
  const $ = cheerio.load(html);
  const reports: AnnualReport[] = [];

  // Extract total pages from the pagination "Fin" link: ?layout=table&start=N
  let totalPages = 1;
  $("a[title='Fin'], a[title='End']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/[?&]start=(\d+)/);
    if (match) {
      const lastStart = parseInt(match[1], 10);
      totalPages = Math.floor(lastStart / 10) + 1;
    }
  });

  $("table.edocman_document_list tr, table.table-document tr").each((_, row) => {
    const $row = $(row);
    // Prefer the aria-label which contains the clean title; fall back to link text
    const titleEl = $row.find(".edocman-document-title-td a[aria-label]").first();
    const titleRaw = titleEl.attr("aria-label")?.trim()
      || $row.find(".edocman_document_link, .edocman_document_list_title a").first().text().trim();
    if (!titleRaw) return;

    const viewLink = $row.find("a.edocman-download-link[href*=viewdocument]").attr("href")
      || $row.find("a[href*=viewdocument]").attr("href") || "";
    const downloadLink = $row.find("a[href*=download]").attr("href") || "";

    // Title format is typically "SYMBOL | Document Title"
    const titleParts = titleRaw.split("|").map((s) => s.trim());
    const symbol = titleParts.length > 1 ? titleParts[0] : "";
    const docTitle = titleParts.length > 1 ? titleParts.slice(1).join(" | ") : titleRaw;
    const documentType = titleParts.length > 1 ? titleParts.slice(1).join(" | ") : undefined;

    // Extract and normalise date from .dateinformation (format: MM-DD-YYYY or MM-DD-YYYY with whitespace)
    const dateRawText = $row.find(".dateinformation").text().trim();
    // Remove the calendar icon text and any non-date characters, keep only digits and dashes
    const dateRaw = dateRawText.replace(/[^\d-]/g, "").trim();
    let publishDate: string | undefined;
    let year = new Date().getFullYear();

    if (dateRaw) {
      // Try MM-DD-YYYY pattern
      const mdyMatch = dateRaw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (mdyMatch) {
        publishDate = `${mdyMatch[3]}-${mdyMatch[1]}-${mdyMatch[2]}`;
        year = parseInt(mdyMatch[3], 10);
      } else {
        // Fallback: extract year from raw date text
        const yearMatch = dateRaw.match(/20\d{2}/);
        if (yearMatch) {
          year = parseInt(yearMatch[0], 10);
        }
        publishDate = dateRaw || undefined;
      }
    }

    // If no date from .dateinformation, try to find year from the title
    if (!publishDate) {
      const yearMatch = titleRaw.match(/20\d{2}/);
      if (yearMatch) {
        year = parseInt(yearMatch[0], 10);
      }
    }

    const url = downloadLink || viewLink;

    reports.push({
      company: symbol || docTitle,
      symbol,
      exchange,
      year,
      title: docTitle,
      url: url.startsWith("http") ? url : `https://www.african-markets.com${url}`,
      fileType: downloadLink.includes("pdf") || titleRaw.toLowerCase().includes("pdf") ? "PDF" : undefined,
      publishDate,
      documentType,
    });
  });

  return { reports, totalPages };
}

/**
 * Parse news articles from the homepage or category pages.
 * The site uses Joomla's Raxo AllMode Pro module:
 *   - article.raxo-item-top (featured)
 *   - article.raxo-item-nor (normal)
 * Inside each: .raxo-title a (title+link), .raxo-date (date)
 */
export function parseMarketNews(html: string): MarketNews[] {
  const $ = cheerio.load(html);
  const news: MarketNews[] = [];

  $("article.raxo-item-top, article.raxo-item-nor").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("h2 a, h3 a, h4 a, .raxo-title a").first();
    const title = titleEl.text().trim();
    const url = titleEl.attr("href") || "";
    const date = $el.find(".raxo-date, time, .item-date").first().text().trim();
    const summary = $el.find(".raxo-introtext, p").first().text().trim();

    if (!title) return;

    // Extract exchange from URL pattern /fr/bourse/{code}/...
    const exchangeMatch = url.match(/\/bourse\/([a-z]+)\//);
    const exchange = exchangeMatch ? exchangeMatch[1].toUpperCase() : undefined;

    news.push({
      title,
      summary: summary.slice(0, 500),
      url: url.startsWith("http") ? url : `https://www.african-markets.com${url}`,
      date: date || new Date().toISOString().split("T")[0],
      exchange,
    });
  });

  return news;
}

/** Parse a numeric value from text, handling French number formatting (1 234,56) */
export function parseNumber(text: string): number {
  const cleaned = text
    .replace(/[^\d,.-]/g, "")
    .replace(/\s/g, "")
    .replace(/,(\d{2})$/, ".$1") // French decimal: "1234,56" → "1234.56"
    .replace(/,/g, ""); // remaining commas are thousand separators
  return parseFloat(cleaned) || 0;
}

function extractExchangeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("brvm")) return "BRVM";
  if (lower.includes("masi") || lower.includes("bvc")) return "BVC";
  if (lower.includes("nse") && lower.includes("asi")) return "NSE";
  if (lower.includes("ngx")) return "NGX";
  if (lower.includes("jse")) return "JSE";
  if (lower.includes("egx")) return "EGX";
  if (lower.includes("tunindex")) return "BVMT";
  if (lower.includes("gse")) return "GSE";
  if (lower.includes("bse") && lower.includes("dci")) return "BSE";
  if (lower.includes("dse")) return "DSE";
  if (lower.includes("sem")) return "SEM";
  if (lower.includes("luse")) return "LUSE";
  if (lower.includes("use") && lower.includes("asi")) return "USE";
  if (lower.includes("rse")) return "RSE";
  if (lower.includes("zse")) return "ZSE";
  if (lower.includes("nsx")) return "NSX";
  if (lower.includes("mse")) return "MSE";
  return "UNKNOWN";
}
