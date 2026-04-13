/**
 * Tests unitaires pour getMarketData
 * Couvre : validation des exchanges, routage par type, structure du résultat
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Fetcher } from "../scraper/fetcher.js";

// Mock des parseurs — on teste le routage, pas le parsing HTML
vi.mock("../scraper/parser.js", () => ({
  parseStockTable: vi.fn().mockReturnValue([
    { symbol: "SNTS", name: "Sonatel", price: 15000, changePercent: 1.5 },
  ]),
  parseMovers: vi.fn().mockReturnValue({ gainers: [], losers: [], mostActive: [] }),
  parseMarketIndices: vi.fn().mockReturnValue([
    { name: "BRVM Composite", value: 200, changePercent: 0.5 },
  ]),
}));

import { getMarketData } from "./market-data.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockFetcher(): Pick<Fetcher, "fetchPage"> {
  return { fetchPage: vi.fn().mockResolvedValue("<html><body></body></html>") };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("getMarketData", () => {
  let fetcher: ReturnType<typeof makeMockFetcher>;

  beforeEach(() => {
    fetcher = makeMockFetcher();
    vi.clearAllMocks();
  });

  // ── Validation ─────────────────────────────────────────────────────────

  describe("validation des exchanges", () => {
    it("lève une erreur pour un code exchange inconnu", async () => {
      await expect(
        getMarketData({ exchange: "UNKNOWN", type: "all" }, fetcher as Fetcher)
      ).rejects.toThrow('Place de marché inconnue: "UNKNOWN"');
    });

    it("liste les codes valides dans le message d'erreur", async () => {
      await expect(
        getMarketData({ exchange: "XYZ", type: "all" }, fetcher as Fetcher)
      ).rejects.toThrow("BRVM");
    });

    it("résout le code exchange de façon insensible à la casse", async () => {
      const result = await getMarketData({ exchange: "brvm", type: "stocks" }, fetcher as Fetcher);
      expect(result.exchange).toMatchObject({ code: "BRVM" });
    });
  });

  // ── Routage par type ───────────────────────────────────────────────────

  describe("routage fetchPage par type", () => {
    it("type=stocks — fetch uniquement listed-companies", async () => {
      await getMarketData({ exchange: "BRVM", type: "stocks" }, fetcher as Fetcher);

      expect(fetcher.fetchPage).toHaveBeenCalledTimes(1);
      expect(fetcher.fetchPage).toHaveBeenCalledWith(expect.stringContaining("listed-companies"));
    });

    it("type=movers — fetch uniquement la page exchange (pas listed-companies)", async () => {
      await getMarketData({ exchange: "BRVM", type: "movers" }, fetcher as Fetcher);

      expect(fetcher.fetchPage).toHaveBeenCalledTimes(1);
      expect(fetcher.fetchPage).not.toHaveBeenCalledWith(
        expect.stringContaining("listed-companies")
      );
      expect(fetcher.fetchPage).toHaveBeenCalledWith(expect.stringContaining("/bourse/brvm"));
    });

    it("type=indices — fetch la page exchange", async () => {
      await getMarketData({ exchange: "BRVM", type: "indices" }, fetcher as Fetcher);

      expect(fetcher.fetchPage).toHaveBeenCalledWith(expect.stringContaining("/bourse/brvm"));
    });

    it("type=all — fetch listed-companies + page exchange (stocks + movers + indices)", async () => {
      await getMarketData({ exchange: "BRVM", type: "all" }, fetcher as Fetcher);

      // 3 appels : listed-companies, /bourse/brvm (movers), /bourse/brvm (indices)
      expect(fetcher.fetchPage).toHaveBeenCalledTimes(3);
      expect(fetcher.fetchPage).toHaveBeenCalledWith(expect.stringContaining("listed-companies"));
      expect(fetcher.fetchPage).toHaveBeenCalledWith(expect.stringContaining("/bourse/brvm"));
    });
  });

  // ── Structure du résultat ──────────────────────────────────────────────

  describe("structure du résultat", () => {
    it("retourne les métadonnées de l'exchange", async () => {
      const result = await getMarketData({ exchange: "JSE", type: "stocks" }, fetcher as Fetcher);

      expect(result.exchange).toMatchObject({
        code: "JSE",
        name: expect.any(String),
        country: expect.any(String),
        currency: expect.any(String),
      });
    });

    it("type=stocks — résultat contient stocks (pas movers ni indices)", async () => {
      const result = await getMarketData({ exchange: "BRVM", type: "stocks" }, fetcher as Fetcher);

      expect(result).toHaveProperty("stocks");
      expect(result).not.toHaveProperty("movers");
      expect(result).not.toHaveProperty("indices");
    });

    it("type=all — résultat contient stocks, movers et indices", async () => {
      const result = await getMarketData({ exchange: "BRVM", type: "all" }, fetcher as Fetcher);

      expect(result).toHaveProperty("stocks");
      expect(result).toHaveProperty("movers");
      expect(result).toHaveProperty("indices");
    });
  });
});
