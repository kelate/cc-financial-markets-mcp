/**
 * MCP tool: get_market_news
 * Fetches latest news from african-markets.com homepage or per-exchange pages.
 */

import { z } from "zod";
import type { Fetcher } from "../scraper/fetcher.js";
import { parseMarketNews } from "../scraper/parser.js";
import { AFRICAN_EXCHANGES } from "../types/markets.js";

export const GetMarketNewsSchema = z.object({
  exchange: z
    .string()
    .optional()
    .describe(
      `Optionnel: filtrer par code de place de marché (${AFRICAN_EXCHANGES.map((e) => e.code).join(", ")}). Sans filtre = actualités générales.`
    ),
  limit: z
    .number()
    .min(1)
    .max(50)
    .default(10)
    .describe("Nombre maximum d'articles à retourner"),
});

export type GetMarketNewsInput = z.infer<typeof GetMarketNewsSchema>;

export async function getMarketNews(input: GetMarketNewsInput, fetcher: Fetcher) {
  let path = "";

  if (input.exchange) {
    const exchange = AFRICAN_EXCHANGES.find(
      (e) => e.code.toLowerCase() === input.exchange!.toLowerCase()
    );
    if (exchange) {
      path = `/bourse/${exchange.url}`;
    }
  }

  // Homepage or exchange page — both have raxo articles
  const html = await fetcher.fetchPage(path || "", 600);
  let news = parseMarketNews(html);

  // If exchange filter given but fetched from homepage, filter by URL pattern
  if (input.exchange && !path) {
    const code = input.exchange.toLowerCase();
    news = news.filter((n) => n.exchange?.toLowerCase() === code);
  }

  return {
    exchange: input.exchange || "all",
    count: Math.min(news.length, input.limit),
    articles: news.slice(0, input.limit),
  };
}
