import type { IMarketDataStrategy } from "./interfaces.js";
import type { Fetcher } from "./fetcher.js";
import { AfricanMarketsStrategy } from "./strategies/african-markets.js";
import { SgbvStrategy } from "./strategies/sgbv.js";
import { BvmacStrategy } from "./strategies/bvmac.js";

export class ScraperFactory {
  public static getStrategy(provider: string, fetcher: Fetcher): IMarketDataStrategy {
    switch (provider) {
      case "sgbv":
        return new SgbvStrategy(fetcher);
      case "bvmac":
        return new BvmacStrategy(fetcher);
      case "african-markets":
      default:
        return new AfricanMarketsStrategy(fetcher);
    }
  }
}
