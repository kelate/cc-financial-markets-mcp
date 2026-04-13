/**
 * MCP tool: get_annual_reports
 * Fetches publications (annual reports, financial docs) via edocman on african-markets.com.
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

  const html = await fetcher.fetchPage(`/bourse/${exchange.url}/publications?layout=table`, 3600);
  let reports = parsePublications(html, exchange.code);

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

  return {
    exchange: { name: exchange.name, code: exchange.code, country: exchange.country },
    filters: { year: input.year, company: input.company },
    count: reports.length,
    reports,
  };
}
