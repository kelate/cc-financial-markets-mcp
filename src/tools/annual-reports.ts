/**
 * MCP tool: get_annual_reports
 * Fetches publications (annual reports, financial docs) via edocman on african-markets.com.
 * Supports pagination, document-type filtering, and force-refresh.
 */

import { z } from "zod";
import type { Fetcher } from "../scraper/fetcher.js";
import { parsePublications } from "../scraper/parser.js";
import { AFRICAN_EXCHANGES } from "../types/markets.js";

export const GetAnnualReportsSchema = z.object({
  exchange: z
    .string()
    .describe(
      `Code de la place de marché (${AFRICAN_EXCHANGES.map((e) => e.code).join(", ")})`
    ),
  year: z
    .number()
    .optional()
    .describe("Année du rapport (ex: 2024). Sans filtre si omis."),
  company: z
    .string()
    .optional()
    .describe("Filtrer par nom d'entreprise ou symbole (recherche partielle, insensible à la casse)"),
  document_type: z
    .string()
    .optional()
    .describe("Filtrer par type de document (recherche partielle insensible à la casse, ex: 'rapport', 'notation')"),
  page: z
    .number()
    .min(1)
    .default(1)
    .describe("Numéro de page (1-based). Défaut: 1."),
  pages: z
    .number()
    .min(1)
    .max(5)
    .default(1)
    .describe("Nombre de pages consécutives à récupérer (max 5). Défaut: 1."),
  force_refresh: z
    .boolean()
    .default(false)
    .describe("Forcer le rechargement depuis le site (ignore le cache)"),
});

export type GetAnnualReportsInput = z.infer<typeof GetAnnualReportsSchema>;

export async function getAnnualReports(input: GetAnnualReportsInput, fetcher: Fetcher) {
  const exchange = AFRICAN_EXCHANGES.find(
    (e) => e.code.toLowerCase() === input.exchange.toLowerCase()
  );
  if (!exchange) {
    const codes = AFRICAN_EXCHANGES.map((e) => `${e.code} (${e.name})`).join(", ");
    throw new Error(`Place de marché inconnue: "${input.exchange}". Codes valides: ${codes}`);
  }

  const currentPage = input.page ?? 1;
  const pagesRequested = input.pages ?? 1;
  const forceRefresh = input.force_refresh ?? false;

  // Fetch all requested pages in sequence and merge results
  let allReports: ReturnType<typeof parsePublications>["reports"] = [];
  let totalPages = 1;

  for (let p = currentPage; p < currentPage + pagesRequested; p++) {
    const start = (p - 1) * 10;
    const path = `/bourse/${exchange.url}/publications?layout=table&start=${start}`;
    const html = await fetcher.fetchPage(path, 3600, forceRefresh);
    const result = parsePublications(html, exchange.code);
    allReports = allReports.concat(result.reports);
    // totalPages from the first page is authoritative (pagination links are present there)
    if (p === currentPage) {
      totalPages = result.totalPages;
    }
  }

  // Apply filters
  let reports = allReports;

  if (input.year) {
    reports = reports.filter((r) => r.year === input.year);
  }

  if (input.company) {
    const search = input.company.toLowerCase();
    reports = reports.filter(
      (r) =>
        r.company.toLowerCase().includes(search) ||
        r.symbol.toLowerCase().includes(search)
    );
  }

  if (input.document_type) {
    const search = input.document_type.toLowerCase();
    reports = reports.filter(
      (r) => r.documentType?.toLowerCase().includes(search) ?? false
    );
  }

  const lastPageFetched = currentPage + pagesRequested - 1;
  const hasMore = lastPageFetched < totalPages;
  const nextPage = hasMore ? lastPageFetched + 1 : null;

  return {
    exchange: { name: exchange.name, code: exchange.code, country: exchange.country },
    filters: {
      year: input.year,
      company: input.company,
      document_type: input.document_type,
      page: currentPage,
      pages: pagesRequested,
    },
    pagination: {
      currentPage,
      pagesRequested,
      totalPages,
      hasMore,
      nextPage,
    },
    count: reports.length,
    reports,
  };
}
