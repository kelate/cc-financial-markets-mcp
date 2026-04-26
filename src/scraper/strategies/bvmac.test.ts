/**
 * Unit tests for BvmacStrategy and its parsers.
 *
 * The strategy consumes the JSON returned by https://bosxch.bvm-ac.org/ws_api/.
 * Fixtures below are reduced extracts of a real live response captured 2026-04-26
 * for the BVMAC trading session of 2026-04-24.
 */

import { describe, it, expect, vi } from "vitest";
import {
  BvmacStrategy,
  extractSessionDate,
  parseBvmacStocksHtml,
  parseFrenchDate,
} from "./bvmac.js";
import type { MarketExchange } from "../../types/markets.js";
import type { Fetcher } from "../fetcher.js";

const BVMAC_EXCHANGE: MarketExchange = {
  name: "Bourse des Valeurs Mobilières de l'Afrique Centrale",
  code: "BVMAC",
  country: "CEMAC",
  currency: "XAF",
  url: "",
  provider: "bvmac",
};

const ACTION_FRAGMENT = `
  <div id="action-market">
    <h3 class="title">Marché des actions</h3>
    <table class="table">
      <thead><tr><th>N° Code</th><th>FIXING VALEURS</th><th colspan="2">Dernier dividende</th><th>Nominal</th><th>Cours de référence</th><th>Cours de Clôture</th><th>Volume demandé</th><th>Volume offert</th><th>Volume transigé</th><th>Variation (%)</th><th>Statut Marché</th></tr></thead>
      <tbody>
        <tr>
          <th>CM0000010009</th>
          <td>ACTION SEMC</td><td>2024-06-27</td>
          <td>540</td><td>10000</td><td>50 000</td>
          <td>50 000</td><td>0</td><td>0</td><td>0</td>
          <td>0,00</td><td>NC</td>
        </tr>
        <tr>
          <th>CM0000010017</th>
          <td>ACTION SAFACAM</td><td>2024-07-22</td>
          <td>436</td><td>5000</td><td>33 000</td>
          <td>33 000</td><td>113</td><td>139</td><td>9</td>
          <td>0</td><td>PEq</td>
        </tr>
        <tr>
          <th>GA0000010066</th>
          <td>ACTIONS SCG-Ré</td><td>2024-09-20</td>
          <td>728</td><td>10000</td><td>21500</td>
          <td>22000</td><td>0</td><td>793</td><td>50</td>
          <td>2,33</td><td>NC</td>
        </tr>
        <tr>
          <th>CM0000010025</th>
          <td>ACTION SOCAPALM</td><td>2024-08-01</td>
          <td>2600</td><td>10000</td><td>50 000</td>
          <td>49 000</td><td>20</td><td>291</td><td>10</td>
          <td>-2,00</td><td>NC</td>
        </tr>
      </tbody>
    </table>
  </div>
`;

const DATE_FRAGMENT = `
  <p class="seance">
    <span class="color-first">SEANCE DE COTATION : </span>
    <span class="color-second">Vendredi 24 Avril 2026</span>
  </p>
`;

function makeApiPayload(
  overrides: Partial<{ action: string; datecapitalisation: string }> = {}
): string {
  return JSON.stringify({
    action: overrides.action ?? ACTION_FRAGMENT,
    obligation: "<div></div>",
    capitalisation: "<div></div>",
    stykerbar: "<div></div>",
    datecapitalisation: overrides.datecapitalisation ?? DATE_FRAGMENT,
  });
}

function makeFetcher(impl: () => Promise<string>) {
  return { fetchPage: vi.fn().mockImplementation(impl) } as unknown as Fetcher;
}

describe("parseFrenchDate", () => {
  it("converts 'Vendredi 24 Avril 2026' to ISO format", () => {
    expect(parseFrenchDate("Vendredi 24 Avril 2026")).toBe("2026-04-24");
  });

  it("handles months with diacritics (février, août, décembre)", () => {
    expect(parseFrenchDate("3 février 2025")).toBe("2025-02-03");
    expect(parseFrenchDate("1 Août 2024")).toBe("2024-08-01");
    expect(parseFrenchDate("31 décembre 2023")).toBe("2023-12-31");
  });

  it("handles months without diacritics (fevrier, aout, decembre)", () => {
    expect(parseFrenchDate("3 fevrier 2025")).toBe("2025-02-03");
    expect(parseFrenchDate("1 aout 2024")).toBe("2024-08-01");
  });

  it("returns null for unparseable text", () => {
    expect(parseFrenchDate("nothing here")).toBeNull();
    expect(parseFrenchDate("32 Foobar 2026")).toBeNull();
  });
});

describe("extractSessionDate", () => {
  it("extracts the date from the seance paragraph", () => {
    expect(extractSessionDate(DATE_FRAGMENT)).toBe("2026-04-24");
  });

  it("falls back to today when the fragment is empty", () => {
    const today = new Date().toISOString().split("T")[0];
    expect(extractSessionDate("<div></div>")).toBe(today);
  });
});

describe("parseBvmacStocksHtml", () => {
  it("parses 4 listed equities from the fixture", () => {
    const stocks = parseBvmacStocksHtml(ACTION_FRAGMENT, "2026-04-24");
    expect(stocks).toHaveLength(4);
    expect(stocks.map((s) => s.symbol)).toEqual(["SEMC", "SAFACAM", "SCG-Ré", "SOCAPALM"]);
  });

  it("strips the 'ACTION' / 'ACTIONS' prefix to derive the symbol", () => {
    const stocks = parseBvmacStocksHtml(ACTION_FRAGMENT, "2026-04-24");
    expect(stocks.find((s) => s.symbol === "SCG-Ré")?.name).toBe("ACTIONS SCG-Ré");
    expect(stocks.find((s) => s.symbol === "SEMC")?.name).toBe("ACTION SEMC");
  });

  it("uses close price when published, otherwise reference price", () => {
    const stocks = parseBvmacStocksHtml(ACTION_FRAGMENT, "2026-04-24");
    // SAFACAM: reference 33000, close 33000 → 33000
    expect(stocks.find((s) => s.symbol === "SAFACAM")?.price).toBe(33000);
    // SOCAPALM: reference 50000, close 49000 (close > 0 → use close)
    expect(stocks.find((s) => s.symbol === "SOCAPALM")?.price).toBe(49000);
  });

  it("parses French-formatted variation percentages including negative values", () => {
    const stocks = parseBvmacStocksHtml(ACTION_FRAGMENT, "2026-04-24");
    expect(stocks.find((s) => s.symbol === "SCG-Ré")?.changePercent).toBe(2.33);
    expect(stocks.find((s) => s.symbol === "SOCAPALM")?.changePercent).toBe(-2);
    expect(stocks.find((s) => s.symbol === "SEMC")?.changePercent).toBe(0);
  });

  it("computes absolute change rounded to whole XAF from variation %", () => {
    const stocks = parseBvmacStocksHtml(ACTION_FRAGMENT, "2026-04-24");
    // SCG-Ré: 22000 * 2.33 / 100 = 512.6 → 513
    expect(stocks.find((s) => s.symbol === "SCG-Ré")?.change).toBe(513);
    // SOCAPALM: 49000 * -2 / 100 = -980
    expect(stocks.find((s) => s.symbol === "SOCAPALM")?.change).toBe(-980);
  });

  it("sets volume from 'Volume transigé' (col 8), undefined when zero", () => {
    const stocks = parseBvmacStocksHtml(ACTION_FRAGMENT, "2026-04-24");
    expect(stocks.find((s) => s.symbol === "SCG-Ré")?.volume).toBe(50);
    expect(stocks.find((s) => s.symbol === "SAFACAM")?.volume).toBe(9);
    expect(stocks.find((s) => s.symbol === "SEMC")?.volume).toBeUndefined();
  });

  it("propagates session date to every quote", () => {
    const stocks = parseBvmacStocksHtml(ACTION_FRAGMENT, "2026-04-24");
    expect(stocks.every((s) => s.date === "2026-04-24")).toBe(true);
  });

  it("returns an empty array when no rows are present", () => {
    expect(parseBvmacStocksHtml("<div id='action-market'></div>", "2026-04-24")).toEqual([]);
  });
});

describe("BvmacStrategy.getMarketData", () => {
  it("returns parsed stocks for type=stocks", async () => {
    const fetcher = makeFetcher(() => Promise.resolve(makeApiPayload()));
    const strategy = new BvmacStrategy(fetcher);

    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "stocks", false);

    expect(fetcher.fetchPage).toHaveBeenCalledWith(
      "https://bosxch.bvm-ac.org/ws_api/",
      300,
      false
    );
    expect(result.stocks).toHaveLength(4);
    expect(result.movers).toBeUndefined();
    expect(result.indices).toBeUndefined();
  });

  it("returns derived movers for type=movers", async () => {
    const fetcher = makeFetcher(() => Promise.resolve(makeApiPayload()));
    const strategy = new BvmacStrategy(fetcher);

    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "movers", false);

    expect(result.movers).toBeDefined();
    expect(result.movers?.gainers.map((s) => s.symbol)).toEqual(["SCG-Ré"]);
    expect(result.movers?.losers.map((s) => s.symbol)).toEqual(["SOCAPALM"]);
    // mostActive: SCG-Ré (50), SOCAPALM (10), SAFACAM (9)
    expect(result.movers?.mostActive.map((s) => s.symbol)).toEqual([
      "SCG-Ré",
      "SOCAPALM",
      "SAFACAM",
    ]);
    expect(result.stocks).toBeUndefined();
  });

  it("returns empty indices for type=indices without fetching (no index published)", async () => {
    const fetcher = makeFetcher(() => Promise.resolve(makeApiPayload()));
    const strategy = new BvmacStrategy(fetcher);

    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "indices", false);

    expect(result.indices).toEqual([]);
    expect(result.stocks).toBeUndefined();
    expect(result.movers).toBeUndefined();
    expect(fetcher.fetchPage).not.toHaveBeenCalled();
  });

  it("returns stocks + movers + empty indices for type=all", async () => {
    const fetcher = makeFetcher(() => Promise.resolve(makeApiPayload()));
    const strategy = new BvmacStrategy(fetcher);

    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "all", false);

    expect(result.stocks).toHaveLength(4);
    expect(result.movers).toBeDefined();
    expect(result.indices).toEqual([]);
  });

  it("forwards forceRefresh to the fetcher", async () => {
    const fetcher = makeFetcher(() => Promise.resolve(makeApiPayload()));
    const strategy = new BvmacStrategy(fetcher);

    await strategy.getMarketData(BVMAC_EXCHANGE, "stocks", true);

    expect(fetcher.fetchPage).toHaveBeenCalledWith(
      "https://bosxch.bvm-ac.org/ws_api/",
      300,
      true
    );
  });

  it("returns empty result on network failure (does not throw)", async () => {
    const fetcher = makeFetcher(() => Promise.reject(new Error("ECONNREFUSED")));
    const strategy = new BvmacStrategy(fetcher);

    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "all", false);

    expect(result.stocks).toEqual([]);
    expect(result.movers).toEqual({ gainers: [], losers: [], mostActive: [] });
    expect(result.indices).toEqual([]);
  });

  it("returns empty result on invalid JSON", async () => {
    const fetcher = makeFetcher(() => Promise.resolve("<html>not json</html>"));
    const strategy = new BvmacStrategy(fetcher);

    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "stocks", false);

    expect(result.stocks).toEqual([]);
  });

  it("returns empty result when 'action' key is missing", async () => {
    const fetcher = makeFetcher(() =>
      Promise.resolve(JSON.stringify({ obligation: "<div></div>" }))
    );
    const strategy = new BvmacStrategy(fetcher);

    const result = await strategy.getMarketData(BVMAC_EXCHANGE, "movers", false);

    expect(result.movers).toEqual({ gainers: [], losers: [], mostActive: [] });
  });
});
