/**
 * MCP tool: get_market_data
 * Fetches real-time stock quotes, movers, and indices for a given African exchange.
 */

import { z } from "zod";
import type { Fetcher } from "../scraper/fetcher.js";
import { AFRICAN_EXCHANGES } from "../types/markets.js";
import { ScraperFactory } from "../scraper/factory.js";

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
    .describe("Si true, ignore le cache et récupère des données fraîches immédiatement depuis la source"),
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

  const forceRefresh = input.force_refresh ?? false;

  const strategy = ScraperFactory.getStrategy(exchange.provider, fetcher);
  const data = await strategy.getMarketData(exchange, input.type, forceRefresh);

  return {
    exchange: { name: exchange.name, code: exchange.code, country: exchange.country, currency: exchange.currency },
    ...data
  };
}
