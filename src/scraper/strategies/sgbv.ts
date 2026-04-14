import type { IMarketDataStrategy, MarketDataResult } from "../interfaces.js";
import type { MarketExchange } from "../../types/markets.js";
import type { Fetcher } from "../fetcher.js";

export class SgbvStrategy implements IMarketDataStrategy {
  constructor(private fetcher: Fetcher) {}

  async getMarketData(
    exchange: MarketExchange,
    type: "stocks" | "movers" | "indices" | "all",
    forceRefresh: boolean
  ): Promise<MarketDataResult> {
    // TODO: Implémenter le scraping spécifique à sgbv.dz
    // Pour l'instant, retourne des données vides pour ne pas bloquer
    return {
      stocks: [],
      indices: []
    };
  }
}
