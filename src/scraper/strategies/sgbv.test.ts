/**
 * Unit tests for SgbvStrategy
 * Uses HTML fixtures matching the real sgbv.dz DOM structure (verified 2026-04-26).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SgbvStrategy } from "./sgbv.js";
import type { MarketExchange } from "../../types/markets.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** histo_boc page: list of sessions with "Détail" links */
const HISTO_BOC_HTML = `
<html><body>
  <table class="table">
    <tr class="table_title"><th>Session</th><th>Date</th><th>Action</th></tr>
    <tr><td>2981</td><td>25/04/2026</td><td><a href="./?page=details_boc&id_sea=2981&lang=fr">Détail</a></td></tr>
    <tr><td>2982</td><td>26/04/2026</td><td><a href="./?page=details_boc&id_sea=2982&lang=fr">Détail</a></td></tr>
    <tr><td>2980</td><td>24/04/2026</td><td><a href="./?page=details_boc&id_sea=2980&lang=fr">Détail</a></td></tr>
  </table>
</body></html>
`;

/** details_boc page: price data for a session */
const DETAILS_BOC_HTML = `
<html><body>
  <table class="table">
    <tr class="table_title">
      <th>Titre</th><th>Cours DA</th><th>Volume transigé</th><th>Valeur transigée</th><th>Nombre de transactions</th>
    </tr>
    <tr><td>BDL</td><td>1 398,00</td><td>29295</td><td>40 954 410,00</td><td>34</td></tr>
    <tr><td>AOM</td><td>585,00</td><td>1200</td><td>702 000,00</td><td>5</td></tr>
    <tr><td>EGH</td><td>210,00</td><td>0</td><td>0,00</td><td>0</td></tr>
    <tr><td>Total</td><td></td><td>30495</td><td>41 656 410,00</td><td>39</td></tr>
  </table>
</body></html>
`;

/** ligne_societe page: company master data */
const LIGNE_SOCIETE_HTML = `
<html><body>
  <table class="table">
    <tr class="table_title">
      <th>Code ISIN</th><th>Code Bourse</th><th>Libellé Valeur</th><th>Secteur</th><th>Valeur Nominale</th><th>Nb actions</th>
    </tr>
    <tr><td>DZ0000000041</td><td>BDL</td><td>Banque de Développement Local</td><td>Finance</td><td>1 000</td><td>5 000 000</td></tr>
    <tr><td>DZ0000000082</td><td>AOM</td><td>Alliance Assurances</td><td>Assurances</td><td>100</td><td>12 000 000</td></tr>
  </table>
</body></html>
`;

/** Empty histo_boc (no session links) */
const EMPTY_HISTO_HTML = `<html><body><p>Aucune session</p></body></html>`;

// ── Helpers ──────────────────────────────────────────────────────────────────

const SGBV_EXCHANGE: MarketExchange = {
  name: "Bourse d'Alger",
  code: "SGBV",
  country: "Algérie",
  currency: "DZD",
  url: "",
  provider: "sgbv",
};

function makeFetcher(responses: Record<string, string>) {
  return {
    fetchPage: vi.fn().mockImplementation((url: string) => {
      // Match by URL substring
      for (const [key, html] of Object.entries(responses)) {
        if (url.includes(key)) return Promise.resolve(html);
      }
      throw new Error(`Unexpected URL: ${url}`);
    }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SgbvStrategy.getMarketData", () => {
  describe("type=stocks", () => {
    it("returns parsed stocks from the latest session", async () => {
      const fetcher = makeFetcher({
        "histo_boc": HISTO_BOC_HTML,
        "ligne_societe": LIGNE_SOCIETE_HTML,
        "details_boc": DETAILS_BOC_HTML,
      });
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "stocks", false);

      expect(result.stocks).toBeDefined();
      expect(result.stocks).toHaveLength(3); // BDL, AOM, EGH — "Total" row excluded
      expect(result.movers).toBeUndefined();
      expect(result.indices).toBeUndefined();
    });

    it("uses the maximum id_sea (latest session)", async () => {
      const fetcher = makeFetcher({
        "histo_boc": HISTO_BOC_HTML,
        "ligne_societe": LIGNE_SOCIETE_HTML,
        "details_boc": DETAILS_BOC_HTML,
      });
      const strategy = new SgbvStrategy(fetcher as any);
      await strategy.getMarketData(SGBV_EXCHANGE, "stocks", false);

      // Third fetchPage call should use id_sea=2982 (max of 2980, 2981, 2982)
      const calls = (fetcher.fetchPage as ReturnType<typeof vi.fn>).mock.calls;
      const detailsCall = calls.find((c: string[]) => c[0].includes("details_boc"));
      expect(detailsCall[0]).toContain("id_sea=2982");
    });

    it("maps tickers to full company names", async () => {
      const fetcher = makeFetcher({
        "histo_boc": HISTO_BOC_HTML,
        "ligne_societe": LIGNE_SOCIETE_HTML,
        "details_boc": DETAILS_BOC_HTML,
      });
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "stocks", false);

      const bdl = result.stocks?.find((s) => s.symbol === "BDL");
      expect(bdl?.name).toBe("Banque de Développement Local");

      const aom = result.stocks?.find((s) => s.symbol === "AOM");
      expect(aom?.name).toBe("Alliance Assurances");
    });

    it("falls back to ticker as name when not in company master", async () => {
      const fetcher = makeFetcher({
        "histo_boc": HISTO_BOC_HTML,
        "ligne_societe": LIGNE_SOCIETE_HTML,
        "details_boc": DETAILS_BOC_HTML,
      });
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "stocks", false);

      // EGH is not in LIGNE_SOCIETE_HTML — should use ticker as name
      const egh = result.stocks?.find((s) => s.symbol === "EGH");
      expect(egh?.name).toBe("EGH");
    });

    it("parses prices in French number format", async () => {
      const fetcher = makeFetcher({
        "histo_boc": HISTO_BOC_HTML,
        "ligne_societe": LIGNE_SOCIETE_HTML,
        "details_boc": DETAILS_BOC_HTML,
      });
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "stocks", false);

      const bdl = result.stocks?.find((s) => s.symbol === "BDL");
      expect(bdl?.price).toBe(1398);
      expect(bdl?.volume).toBe(29295);

      const aom = result.stocks?.find((s) => s.symbol === "AOM");
      expect(aom?.price).toBe(585);
    });

    it("sets change and changePercent to 0 (not available from SGBV)", async () => {
      const fetcher = makeFetcher({
        "histo_boc": HISTO_BOC_HTML,
        "ligne_societe": LIGNE_SOCIETE_HTML,
        "details_boc": DETAILS_BOC_HTML,
      });
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "stocks", false);

      for (const stock of result.stocks ?? []) {
        expect(stock.change).toBe(0);
        expect(stock.changePercent).toBe(0);
        expect(stock.exchange).toBe("SGBV");
      }
    });

    it("excludes the Total summary row", async () => {
      const fetcher = makeFetcher({
        "histo_boc": HISTO_BOC_HTML,
        "ligne_societe": LIGNE_SOCIETE_HTML,
        "details_boc": DETAILS_BOC_HTML,
      });
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "stocks", false);

      const totals = result.stocks?.filter((s) => s.symbol.toLowerCase().startsWith("total"));
      expect(totals).toHaveLength(0);
    });
  });

  describe("type=movers", () => {
    it("returns derived movers (mostActive by volume)", async () => {
      const fetcher = makeFetcher({
        "histo_boc": HISTO_BOC_HTML,
        "ligne_societe": LIGNE_SOCIETE_HTML,
        "details_boc": DETAILS_BOC_HTML,
      });
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "movers", false);

      expect(result.movers).toBeDefined();
      expect(result.movers?.mostActive).toHaveLength(2); // BDL (29295) and AOM (1200) — EGH has vol=0
      expect(result.movers?.mostActive[0].symbol).toBe("BDL");
      expect(result.movers?.mostActive[1].symbol).toBe("AOM");
      expect(result.movers?.gainers).toHaveLength(0);
      expect(result.movers?.losers).toHaveLength(0);
      expect(result.stocks).toBeUndefined();
    });
  });

  describe("type=indices", () => {
    it("returns empty indices array (AL30/ML30 always show 0)", async () => {
      const fetcher = makeFetcher({});
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "indices", false);

      expect(result.indices).toEqual([]);
      // Should not fetch any page for indices-only request
      expect((fetcher.fetchPage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });
  });

  describe("type=all", () => {
    it("returns stocks, movers and empty indices", async () => {
      const fetcher = makeFetcher({
        "histo_boc": HISTO_BOC_HTML,
        "ligne_societe": LIGNE_SOCIETE_HTML,
        "details_boc": DETAILS_BOC_HTML,
      });
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "all", false);

      expect(result.stocks).toBeDefined();
      expect(result.movers).toBeDefined();
      expect(result.indices).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("returns empty result when histo_boc fetch fails", async () => {
      const fetcher = {
        fetchPage: vi.fn().mockRejectedValue(new Error("Network error")),
      };
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "stocks", false);

      expect(result.stocks).toEqual([]);
      expect(result.movers).toBeDefined();
      expect(result.indices).toEqual([]);
    });

    it("returns empty result when no session ids found in histo_boc", async () => {
      const fetcher = makeFetcher({
        "histo_boc": EMPTY_HISTO_HTML,
        "ligne_societe": LIGNE_SOCIETE_HTML,
        "details_boc": DETAILS_BOC_HTML,
      });
      const strategy = new SgbvStrategy(fetcher as any);
      const result = await strategy.getMarketData(SGBV_EXCHANGE, "stocks", false);

      expect(result.stocks).toEqual([]);
    });
  });
});
