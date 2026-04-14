import type { IMarketDataStrategy, MarketDataResult } from "../interfaces.js";
import type { MarketExchange } from "../../types/markets.js";
import type { Fetcher } from "../fetcher.js";
import { parseMarketIndices, parseMovers, parseStockTable } from "../parser.js";

export class AfricanMarketsStrategy implements IMarketDataStrategy {
  constructor(private fetcher: Fetcher) {}

  async getMarketData(
    exchange: MarketExchange,
    type: "stocks" | "movers" | "indices" | "all",
    forceRefresh: boolean
  ): Promise<MarketDataResult> {
    const result: MarketDataResult = {};

    if (type === "stocks" || type === "all") {
      const html = await this.fetcher.fetchPage(`/bourse/${exchange.url}/listed-companies`, undefined, forceRefresh);
      result.stocks = parseStockTable(html, exchange.code);
    }

    if (type === "movers" || type === "all") {
      const html = await this.fetcher.fetchPage(`/bourse/${exchange.url}`, undefined, forceRefresh);
      result.movers = parseMovers(html, exchange.code);
    }

    if (type === "indices" || type === "all") {
      // Indices table appears on every exchange page — reuse already-fetched HTML when possible
      const html = (type === "all")
        ? await this.fetcher.fetchPage(`/bourse/${exchange.url}`, undefined, false) // already in cache from movers step
        : await this.fetcher.fetchPage(`/bourse/${exchange.url}`, undefined, forceRefresh);
      result.indices = parseMarketIndices(html);
    }

    return result;
  }
}
