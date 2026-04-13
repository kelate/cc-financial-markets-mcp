/**
 * MCP tool: get_company_documents
 * Fetches all documents published by a specific company (press releases, annual reports,
 * financial statements, dividends) from the company profile page on african-markets.com.
 * Premium content requires AFRICAN_MARKETS_USERNAME / AFRICAN_MARKETS_PASSWORD in .env.
 */

import { z } from "zod";
import * as cheerio from "cheerio";
import type { Fetcher } from "../scraper/fetcher.js";
import { AFRICAN_EXCHANGES } from "../types/markets.js";

export const GetCompanyDocumentsSchema = z.object({
  exchange: z
    .string()
    .describe(
      `Code de la place de marché (${AFRICAN_EXCHANGES.map((e) => e.code).join(", ")})`
    ),
  symbol: z
    .string()
    .describe("Code/symbole de l'action (ex: SDSC, SNTS, NPN)"),
  document_type: z
    .enum(["all", "annual_report", "financial_statement", "press_release", "dividend"])
    .default("all")
    .describe("Type de document à récupérer. 'all' retourne tous les types."),
  force_refresh: z
    .boolean()
    .default(false)
    .describe("Forcer le rechargement depuis le site (ignorer le cache)"),
});

export type GetCompanyDocumentsInput = z.infer<typeof GetCompanyDocumentsSchema>;

export interface CompanyDocument {
  type: "annual_report" | "financial_statement" | "press_release" | "dividend" | "other";
  title: string;
  year?: number;
  date?: string;
  url: string;
  fileType?: string;
}

/** Detect document type from title text */
function classifyDocument(title: string): CompanyDocument["type"] {
  const lower = title.toLowerCase();
  if (
    lower.includes("annual report") ||
    lower.includes("rapport annuel")
  ) return "annual_report";
  if (
    lower.includes("financial statement") ||
    lower.includes("état financier") ||
    lower.includes("états financiers") ||
    lower.includes("bilan") ||
    lower.includes("compte de résultat")
  ) return "financial_statement";
  if (
    lower.includes("dividende") ||
    lower.includes("dividend") ||
    lower.includes("paiement de dividende")
  ) return "dividend";
  if (
    lower.includes("communiqué") ||
    lower.includes("press release") ||
    lower.includes("convocation") ||
    lower.includes("avis") ||
    lower.includes("résolution") ||
    lower.includes("notation") ||
    lower.includes("bilan semestriel")
  ) return "press_release";
  return "other";
}

/** Parse a French date string like "18 sept. 2025" → "2025-09-18" */
function parseFrenchDate(raw: string): string | undefined {
  const months: Record<string, string> = {
    "janv": "01", "févr": "02", "mars": "03", "avril": "04",
    "mai": "05", "juin": "06", "juil": "07", "août": "08",
    "sept": "09", "oct": "10", "nov": "11", "déc": "12",
  };
  const m = raw.trim().match(/(\d{1,2})\s+(\w+)\.?\s+(\d{4})/);
  if (!m) return undefined;
  const day = m[1].padStart(2, "0");
  const monthKey = m[2].toLowerCase();
  const month = months[monthKey];
  if (!month) return undefined;
  return `${m[3]}-${month}-${day}`;
}

/** Resolve a relative URL to absolute */
function absoluteUrl(href: string): string {
  if (!href || href.trim() === "") return "";
  if (href.startsWith("http")) return href;
  return `https://www.african-markets.com${href.trim()}`;
}

export async function getCompanyDocuments(
  input: GetCompanyDocumentsInput,
  fetcher: Fetcher
) {
  const exchange = AFRICAN_EXCHANGES.find(
    (e) => e.code.toLowerCase() === input.exchange.toLowerCase()
  );
  if (!exchange) {
    const codes = AFRICAN_EXCHANGES.map((e) => `${e.code} (${e.name})`).join(", ");
    throw new Error(`Place de marché inconnue: "${input.exchange}". Codes valides: ${codes}`);
  }

  const symbol = input.symbol.toUpperCase();
  const path = `/bourse/${exchange.url}/listed-companies/company?code=${symbol}`;

  const html = await fetcher.fetchPage(
    path,
    1800,
    input.force_refresh
  );

  // Detect paywall
  if (html.includes("Abonnez-vous pour un accès illimité") || html.includes("Subscribe for unlimited access")) {
    throw new Error(
      `Historique premium requis pour ${symbol}. Configurez AFRICAN_MARKETS_USERNAME et AFRICAN_MARKETS_PASSWORD dans .env.`
    );
  }

  const $ = cheerio.load(html);

  // Company name from h2
  const companyName = $("h2").first().text().trim() || symbol;

  const documents: CompanyDocument[] = [];

  // Parse "Rapports Annuels & Financiers" section
  // The section heading contains "Rapports Annuels" and is followed by an edocman table
  $("h3").each((_, h3El) => {
    const heading = $(h3El).text().trim().toLowerCase();
    const isAnnualReports =
      heading.includes("rapports annuels") ||
      heading.includes("annual report");

    if (!isAnnualReports) return;

    const table = $(h3El).nextAll("table.edocman_document_list").first();
    table.find("tr").each((_, row) => {
      const titleEl = $(row).find(".edocman_document_list_title2 a, a").first();
      const title = titleEl.text().trim();
      if (!title) return;

      const href = titleEl.attr("href") || "";
      const yearCell = $(row).find("td").last().text().trim();
      const year = parseInt(yearCell, 10) || undefined;

      // Determine sub-type from title
      const docTitle = title.toLowerCase();
      let docType: CompanyDocument["type"] = "annual_report";
      if (docTitle.includes("financial statement") || docTitle.includes("états financiers") || docTitle.includes("état financier")) {
        docType = "financial_statement";
      }

      documents.push({
        type: docType,
        title: title.replace(/\s+/g, " ").trim(),
        year,
        url: absoluteUrl(href),
        fileType: href.includes("pdf") ? "pdf" : undefined,
      });
    });
  });

  // Parse the large communiqués / press releases table
  // This table appears after "About the company" or "Competitors" sections and before "Analyse & Recherche"
  // It's usually the 2nd or 3rd edocman_document_list table on the page
  // Strategy: find tables that contain edocman document links with .edocman_document_list_title2 and a date cell
  $("table.edocman_document_list").each((tableIdx, tableEl) => {
    // Skip the competitors table (has price/percent columns)
    const firstRow = $(tableEl).find("tr").first();
    const firstCellText = firstRow.find("td").first().text().trim();

    // Competitors table rows have company links to /company?code= paths
    // Dividend tables have amount patterns like "92 XOF"
    // Press releases have .edocman_document_list_title2 with PDF icon links

    const rows = $(tableEl).find("tr");
    let isPressReleaseTable = false;
    let isDividendTable = false;
    let isCompetitorTable = false;

    // Check the first data row to classify the table
    rows.each((rowIdx, row) => {
      if (rowIdx > 0) return; // Only check first data row
      const cells = $(row).find("td");
      if (cells.length < 2) return;

      const cell0 = $(cells[0]).text().trim();
      const cell0Html = $(cells[0]).html() || "";
      const cell1 = cells.length > 1 ? $(cells[1]).text().trim() : "";

      // Competitor table: first cell links to /company?code=
      if ($(cells[0]).find("a[href*='company?code=']").length > 0) {
        isCompetitorTable = true;
        return;
      }
      // Dividend table: first cell is amount with currency like "92 XOF"
      if (/^\d+[\s\d]*[A-Z]{3}$/.test(cell0) || $(cells[0]).attr("style")?.includes("font-weight: bold")) {
        // Could be dividend - check for date in last cell
        if (cell0.match(/\d+\s+[A-Z]{3}/)) {
          isDividendTable = true;
          return;
        }
      }
      // Press release table: has edocman PDF icon or edocman link
      if (cell0Html.includes("edicon-file-pdf") || cell0Html.includes("edocman")) {
        isPressReleaseTable = true;
        return;
      }
    });

    if (isCompetitorTable) return; // skip

    if (isDividendTable) {
      rows.each((rowIdx, row) => {
        const cells = $(row).find("td");
        if (cells.length < 2) return;
        const amount = $(cells[0]).text().trim();
        const dateText = $(cells[cells.length - 1]).text().trim();
        if (!amount || !amount.match(/\d/)) return;

        documents.push({
          type: "dividend",
          title: `Dividende : ${amount}`,
          date: parseFrenchDate(dateText),
          url: "",
          fileType: undefined,
        });
      });
      return;
    }

    if (isPressReleaseTable) {
      rows.each((_, row) => {
        const titleEl = $(row).find(".edocman_document_list_title2 a, a").first();
        const title = titleEl.text().trim().replace(/\s+/g, " ");
        if (!title) return;

        const href = titleEl.attr("href") || "";
        const dateText = $(row).find("td").last().text().trim();
        const date = parseFrenchDate(dateText);

        // Try to extract year from date
        const yearMatch = dateText.match(/(\d{4})/);
        const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

        const docType = classifyDocument(title);

        documents.push({
          type: docType,
          title,
          date,
          year,
          url: absoluteUrl(href),
          fileType: href.includes("pdf") || $(row).find(".edicon-file-pdf").length > 0 ? "pdf" : undefined,
        });
      });
    }
  });

  // Filter by document_type
  let filteredDocs = documents;
  if (input.document_type !== "all") {
    filteredDocs = documents.filter((d) => d.type === input.document_type);
  }

  return {
    exchange: {
      name: exchange.name,
      code: exchange.code,
      country: exchange.country,
      currency: exchange.currency,
    },
    symbol,
    company: companyName,
    documentType: input.document_type,
    count: filteredDocs.length,
    documents: filteredDocs,
  };
}
