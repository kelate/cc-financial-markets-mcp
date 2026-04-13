/**
 * MCP tool: get_market_data
 * Fetches real-time stock quotes, movers, and indices for a given African exchange.
 */

import { z } from "zod";
import type { Fetcher } from "../scraper/fetcher.js";
import { parseMarketIndices, parseMovers, parseStockTable } from "../scraper/parser.js";
import { AFRICAN_EXCHANGES } from "../types/markets.js";

export const GetMarketDataSchema = z.object({
  exchange: z
    .string()
    .describe(
      `Code de la place de marché (${AFRICAN_EXCHANGES.map((e) => e.code).join(", ")})`
    ),
  type: z
    .enum(["stocks", "movers", "indices", "all"])
    .default("all")
    .describe("Type de données: stocks (toutes les actions cotées), movers (top hausses/baisses/volumes), indices (indices de marché), ou all"),
  force_refresh: z
    .boolean()
    .default(false)
    .describe("Si true, ignore le cache et récupère des données fraîches immédiatement depuis african-markets.com"),
});

export type GetMarketDataInput = z.infer<typeof GetMarketDataSchema>;

export async function getMarketData(input: GetMarketDataInput, fetcher: Fetcher) {
  const exchange = AFRICAN_EXCHANGES.find(
    (e) => e.code.toLowerCase() === input.exchange.toLowerCase()
  );
  if (!exchange) {
    const codes = AFRICAN_EXCHANGES.map((e) => `${e.code} (${e.name})`).join(", ");
    throw new Error(`Place de marché inconnue: "${input.exchange}". Codes valides: ${codes}`);
  }

  const result: Record<string, unknown> = {
    exchange: { name: exchange.name, code: exchange.code, country: exchange.country, currency: exchange.currency },
  };

  const forceRefresh = input.force_refresh ?? false;

  if (input.type === "stocks" || input.type === "all") {
    const html = await fetcher.fetchPage(`/bourse/${exchange.url}/listed-companies`, undefined, forceRefresh);
    result.stocks = parseStockTable(html, exchange.code);
  }

  if (input.type === "movers" || input.type === "all") {
    const html = await fetcher.fetchPage(`/bourse/${exchange.url}`, undefined, forceRefresh);
    result.movers = parseMovers(html, exchange.code);
  }

  if (input.type === "indices" || input.type === "all") {
    // Indices table appears on every exchange page — reuse already-fetched HTML when possible
    const html = (input.type === "all")
      ? await fetcher.fetchPage(`/bourse/${exchange.url}`, undefined, false) // already in cache from movers step
      : await fetcher.fetchPage(`/bourse/${exchange.url}`, undefined, forceRefresh);
    result.indices = parseMarketIndices(html);
  }

  return result;
}
