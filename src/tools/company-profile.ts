/**
 * MCP tool: get_company_profile
 * Fetches detailed company profile from african-markets.com (premium content).
 * Includes: company info, annual reports, financial statements, communiqués, dividends.
 */

import { z } from "zod";
import * as cheerio from "cheerio";
import type { Fetcher } from "../scraper/fetcher.js";
import { parseNumber } from "../scraper/parser.js";
import { AFRICAN_EXCHANGES } from "../types/markets.js";

export const GetCompanyProfileSchema = z.object({
  exchange: z
    .string()
    .describe(
      `Code de la place de marché (${AFRICAN_EXCHANGES.map((e) => e.code).join(", ")})`
    ),
  symbol: z
    .string()
    .describe("Code/symbole de l'action (ex: SNTS pour Sonatel, ETIT pour Ecobank, SGBC pour SGB CI)"),
});

export type GetCompanyProfileInput = z.infer<typeof GetCompanyProfileSchema>;

interface CompanyInfo {
  symbol: string;
  isin?: string;
  founded?: string;
  listed?: string;
  phone?: string;
  fax?: string;
  address?: string;
}

interface Document {
  title: string;
  year?: number;
  date?: string;
  url: string;
  type?: string;
}

interface Dividend {
  amount: string;
  date: string;
}

export async function getCompanyProfile(input: GetCompanyProfileInput, fetcher: Fetcher) {
  const exchange = AFRICAN_EXCHANGES.find(
    (e) => e.code.toLowerCase() === input.exchange.toLowerCase()
  );
  if (!exchange) {
    const codes = AFRICAN_EXCHANGES.map((e) => `${e.code} (${e.name})`).join(", ");
    throw new Error(`Place de marché inconnue: "${input.exchange}". Codes valides: ${codes}`);
  }

  const html = await fetcher.fetchPage(
    `/bourse/${exchange.url}/listed-companies/company?code=${input.symbol.toUpperCase()}`,
    1800 // 30 min cache for profiles
  );

  const $ = cheerio.load(html);
  const isPremium = !html.includes("Abonnez-vous pour un accès illimité");

  // --- Company info (first table) ---
  const info: CompanyInfo = { symbol: input.symbol.toUpperCase() };
  const infoTable = $("table").first();
  infoTable.find("tr").each((_, row) => {
    const text = $(row).text().replace(/\s+/g, " ").trim();
    const isinMatch = text.match(/ISIN\s*([A-Z]{2}[A-Z0-9]{10})/);
    if (isinMatch) info.isin = isinMatch[1];
    const foundedMatch = text.match(/Création\s*(\d{4})/);
    if (foundedMatch) info.founded = foundedMatch[1];
    const listedMatch = text.match(/Cotation\s*(\d{4})/);
    if (listedMatch) info.listed = listedMatch[1];
    const phoneMatch = text.match(/Téléphone\s*([\d()+\s/]+)/);
    if (phoneMatch) info.phone = phoneMatch[1].trim();
    if (!info.address) {
      const cells = $(row).find("td");
      if (cells.length === 1) {
        const addr = $(cells[0]).text().trim();
        if (addr.length > 20 && !addr.includes("SYMBOL")) info.address = addr;
      }
    }
  });

  // --- Company name from h2 ---
  const companyName = $("h2").first().text().trim() || input.symbol;

  // --- Parse sections by h3 headings ---
  const annualReports: Document[] = [];
  const _financialStatements: Document[] = [];
  const communiques: Document[] = [];
  const research: Document[] = [];
  const dividends: Dividend[] = [];

  $("h3").each((_, h3) => {
    const heading = $(h3).text().trim().toLowerCase();
    const table = $(h3).nextAll("table.edocman_document_list").first();

    if (heading.includes("rapports annuels") || heading.includes("annual report")) {
      table.find("tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 2) return;
        const title = $(cells[0]).text().trim();
        const yearText = $(cells[1]).text().trim();
        const link = $(row).find("a[href*=edocman], a[href*=download]").first().attr("href") || "";
        if (title) {
          annualReports.push({
            title,
            year: parseInt(yearText, 10) || undefined,
            url: link.startsWith("http") ? link : `https://www.african-markets.com${link}`,
            type: link.includes("pdf") ? "PDF" : undefined,
          });
        }
      });
    } else if (heading.includes("communiqué") || heading.includes("about")) {
      table.find("tr").each((_, row) => {
        const titleEl = $(row).find(".edocman_document_link, a").first();
        const title = titleEl.text().trim();
        const link = titleEl.attr("href") || "";
        const date = $(row).find("td").last().text().trim();
        if (title) {
          communiques.push({
            title,
            date,
            url: link.startsWith("http") ? link : `https://www.african-markets.com${link}`,
          });
        }
      });
    } else if (heading.includes("analyse") || heading.includes("research")) {
      table.find("tr").each((_, row) => {
        const titleEl = $(row).find(".edocman_document_link, a").first();
        const title = titleEl.text().trim();
        const link = titleEl.attr("href") || "";
        const date = $(row).find("td").last().text().trim();
        if (title) {
          research.push({
            title,
            date,
            url: link.startsWith("http") ? link : `https://www.african-markets.com${link}`,
          });
        }
      });
    } else if (heading.includes("dividende") || heading.includes("dividend")) {
      table.find("tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 2) return;
        const amount = $(cells[0]).text().trim();
        const date = $(cells[1]).text().trim();
        if (amount && parseNumber(amount) > 0) {
          dividends.push({ amount, date });
        }
      });
    }
  });

  // --- Current price from competitors table (table index 1) ---
  let currentPrice: { price: number; change: string } | undefined;
  $("table.edocman_document_list").eq(0).find("tr").each((_, row) => {
    const text = $(row).text();
    if (text.includes(input.symbol.toUpperCase())) {
      const cells = $(row).find("td");
      if (cells.length >= 3) {
        currentPrice = {
          price: parseNumber($(cells[1]).text().trim()),
          change: $(cells[2]).text().trim(),
        };
      }
    }
  });

  return {
    exchange: { name: exchange.name, code: exchange.code, country: exchange.country, currency: exchange.currency },
    premium: isPremium,
    company: {
      name: companyName,
      ...info,
    },
    currentPrice,
    annualReports: { count: annualReports.length, items: annualReports },
    communiques: { count: communiques.length, items: communiques },
    research: { count: research.length, items: research },
    dividends: { count: dividends.length, items: dividends },
  };
}
