/**
 * Unit tests for BvmacStrategy
 *
 * BvmacStrategy is a documented stub: the BVMAC site loads market data via AJAX
 * from https://bosxch.bvm-ac.org/ws_api/ which is DNS SERVFAIL.
 * These tests verify:
 *   - The strategy returns empty, well-typed results for all request types
 *   - No fetcher calls are made (no live requests to a broken endpoint)
 *   - The return structure is always complete (no undefined fields for requested type)
 */

import { describe, it, expect, vi } from "vitest";
import { BvmacStrategy } from "./bvmac.js";
import type { MarketExchange } from "../../types/markets.js";

const BVMAC_EXCHANGE: MarketExchange = {
  name: "Bourse des Valeurs Mobilières de l'Afrique Centrale",
  code: "BVMAC",
  country: "CEMAC",
  currency: "XAF",
  url: "",
  provider: "bvmac",
};

function makeFetcher() {
  return {
    fetchPage: vi.fn().mockRejectedValue(new Error("Should not be called")),
  };
}

describe("BvmacStrategy.getMarketData", () => {
  it("returns empty stocks for type=stocks without fetching", async () => {
    const fetcher = makeFetcher();
    const strategy = new BvmacStrategy(fetcher as any);
    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "stocks", false);

    expect(result.stocks).toEqual([]);
    expect(result.movers).toBeUndefined();
    expect(result.indices).toBeUndefined();
    expect(fetcher.fetchPage).not.toHaveBeenCalled();
  });

  it("returns empty movers for type=movers without fetching", async () => {
    const fetcher = makeFetcher();
    const strategy = new BvmacStrategy(fetcher as any);
    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "movers", false);

    expect(result.movers).toBeDefined();
    expect(result.movers?.gainers).toEqual([]);
    expect(result.movers?.losers).toEqual([]);
    expect(result.movers?.mostActive).toEqual([]);
    expect(result.stocks).toBeUndefined();
    expect(fetcher.fetchPage).not.toHaveBeenCalled();
  });

  it("returns empty indices for type=indices without fetching", async () => {
    const fetcher = makeFetcher();
    const strategy = new BvmacStrategy(fetcher as any);
    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "indices", false);

    expect(result.indices).toEqual([]);
    expect(result.stocks).toBeUndefined();
    expect(result.movers).toBeUndefined();
    expect(fetcher.fetchPage).not.toHaveBeenCalled();
  });

  it("returns all empty collections for type=all without fetching", async () => {
    const fetcher = makeFetcher();
    const strategy = new BvmacStrategy(fetcher as any);
    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "all", false);

    expect(result.stocks).toEqual([]);
    expect(result.movers?.gainers).toEqual([]);
    expect(result.movers?.losers).toEqual([]);
    expect(result.movers?.mostActive).toEqual([]);
    expect(result.indices).toEqual([]);
    expect(fetcher.fetchPage).not.toHaveBeenCalled();
  });

  it("behaves identically with forceRefresh=true (no live fetch)", async () => {
    const fetcher = makeFetcher();
    const strategy = new BvmacStrategy(fetcher as any);
    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "all", true);

    expect(result.stocks).toEqual([]);
    expect(fetcher.fetchPage).not.toHaveBeenCalled();
  });
});
