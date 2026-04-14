/**
 * MCP tool: get_index_history
 * Fetches historical index data (close price + volume) for a given African exchange.
 * Parses the inline `chartData` JS variable from the exchange overview page.
 */

import { z } from "zod";
import type { Fetcher } from "../scraper/fetcher.js";
import { parseIndexHistory } from "../scraper/index-history-parser.js";
import { AFRICAN_EXCHANGES } from "../types/markets.js";

export const GetIndexHistorySchema = z.object({
  exchange: z
    .string()
    .describe(
      `Code de la place de marché (${AFRICAN_EXCHANGES.map((e) => e.code).join(", ")})`
    ),
  period: z
    .enum(["1m", "3m", "6m", "1y", "3y", "5y", "all"])
    .default("1y")
    .describe("Période historique: 1m, 3m, 6m, 1y (défaut), 3y, 5y, ou all"),
  force_refresh: z
    .boolean()
    .default(false)
    .describe("Force le rechargement depuis le site (ignore le cache)"),
});

export type GetIndexHistoryInput = z.infer<typeof GetIndexHistorySchema>;

/** Maps period codes to number of days to look back from today. */
const PERIOD_DAYS: Record<string, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  "3y": 365 * 3,
  "5y": 365 * 5,
};

export async function getIndexHistory(input: GetIndexHistoryInput, fetcher: Fetcher) {
  const exchange = AFRICAN_EXCHANGES.find(
    (e) => e.code.toLowerCase() === input.exchange.toLowerCase()
  );
  if (!exchange) {
    const codes = AFRICAN_EXCHANGES.map((e) => `${e.code} (${e.name})`).join(", ");
    throw new Error(`Place de marché inconnue: "${input.exchange}". Codes valides: ${codes}`);
  }

  const html = await fetcher.fetchPage(`/bourse/${exchange.url}`, undefined, input.force_refresh);

  let dataPoints = parseIndexHistory(html);

  if (input.period !== "all") {
    const days = PERIOD_DAYS[input.period];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoff = cutoffDate.toISOString().slice(0, 10); // "YYYY-MM-DD"
    dataPoints = dataPoints.filter((p) => p.date >= cutoff);
  }

  return {
    exchange: {
      name: exchange.name,
      code: exchange.code,
      country: exchange.country,
      currency: exchange.currency,
    },
    period: input.period,
    count: dataPoints.length,
    dataPoints,
  };
}
