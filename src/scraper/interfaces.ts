import type { MarketExchange, StockQuote, MarketIndex } from "../types/markets.js";

export interface MarketDataResult {
  stocks?: StockQuote[];
  movers?: {
    gainers: StockQuote[];
    losers: StockQuote[];
    mostActive: StockQuote[];
  };
  indices?: MarketIndex[];
}

export interface IMarketDataStrategy {
  getMarketData(
    exchange: MarketExchange,
    type: "stocks" | "movers" | "indices" | "all",
    forceRefresh: boolean
  ): Promise<MarketDataResult>;
}
