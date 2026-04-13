/**
 * MCP tool: get_stock_history
 * Fetches historical OHLCV price data for an individual stock listed on an African exchange.
 *
 * Data source: african-markets.com company profile pages (premium content).
 * Requires valid AFRICAN_MARKETS_USERNAME / AFRICAN_MARKETS_PASSWORD credentials to access
 * the chart data — unauthenticated requests only receive a paywall response.
 */

import { z } from "zod";
import type { Fetcher } from "../scraper/fetcher.js";
import { parseStockHistory, type StockDataPoint } from "../scraper/stock-history-parser.js";
import { AFRICAN_EXCHANGES } from "../types/markets.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const GetStockHistorySchema = z.object({
  exchange: z
    .string()
    .describe(
      `Code de la place de marché (${AFRICAN_EXCHANGES.map((e) => e.code).join(", ")})`
    ),
  symbol: z
    .string()
    .describe("Ticker/symbole de l'action (ex: SDSC, NPN, SNTS)"),
  period: z
    .enum(["1m", "3m", "6m", "1y", "3y", "5y", "all"])
    .default("1y")
    .describe(
      "Période d'historique à retourner: 1m (1 mois), 3m, 6m, 1y (1 an, défaut), 3y, 5y, all (tout)"
    ),
  force_refresh: z
    .boolean()
    .default(false)
    .describe("Forcer le rechargement depuis le site (ignore le cache)"),
});

export type GetStockHistoryInput = z.infer<typeof GetStockHistorySchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function getStockHistory(
  input: GetStockHistoryInput,
  fetcher: Fetcher
) {
  // Resolve exchange
  const exchange = AFRICAN_EXCHANGES.find(
    (e) => e.code.toLowerCase() === input.exchange.toLowerCase()
  );
  if (!exchange) {
    const codes = AFRICAN_EXCHANGES.map((e) => `${e.code} (${e.name})`).join(", ");
    throw new Error(
      `Place de marché inconnue: "${input.exchange}". Codes valides: ${codes}`
    );
  }

  const symbol = input.symbol.toUpperCase();

  const html = await fetcher.fetchPage(
    `/bourse/${exchange.url}/listed-companies/company?code=${symbol}`,
    undefined,
    input.force_refresh
  );

  // Parse historical data
  const allPoints = parseStockHistory(html);

  if (allPoints.length === 0) {
    throw new Error(
      `Données premium requises pour l'historique de ${symbol}. ` +
        `Configurez AFRICAN_MARKETS_USERNAME et AFRICAN_MARKETS_PASSWORD dans .env pour accéder à l'historique des cours.`
    );
  }

  // Filter by requested period
  const dataPoints = filterByPeriod(allPoints, input.period);

  return {
    exchange: {
      name: exchange.name,
      code: exchange.code,
      country: exchange.country,
      currency: exchange.currency,
    },
    symbol,
    period: input.period,
    count: dataPoints.length,
    dataPoints,
  };
}

// ---------------------------------------------------------------------------
// Period filter
// ---------------------------------------------------------------------------

function filterByPeriod(
  points: StockDataPoint[],
  period: GetStockHistoryInput["period"]
): StockDataPoint[] {
  if (period === "all") return points;

  const now = new Date();
  const cutoff = new Date(now);

  switch (period) {
    case "1m":
      cutoff.setMonth(cutoff.getMonth() - 1);
      break;
    case "3m":
      cutoff.setMonth(cutoff.getMonth() - 3);
      break;
    case "6m":
      cutoff.setMonth(cutoff.getMonth() - 6);
      break;
    case "1y":
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      break;
    case "3y":
      cutoff.setFullYear(cutoff.getFullYear() - 3);
      break;
    case "5y":
      cutoff.setFullYear(cutoff.getFullYear() - 5);
      break;
  }

  const cutoffStr = cutoff.toISOString().slice(0, 10); // "YYYY-MM-DD"
  return points.filter((p) => p.date >= cutoffStr);
}
