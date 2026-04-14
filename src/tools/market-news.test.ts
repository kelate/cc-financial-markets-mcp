/**
 * Tests unitaires pour getMarketNews
 * Couvre : filtre exchange, limite d'articles, routing homepage vs exchange
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Fetcher } from "../scraper/fetcher.js";

// Mock du parseur avec des articles de test
vi.mock("../scraper/parser.js", () => ({
  parseMarketNews: vi.fn().mockReturnValue([
    { title: "Article BRVM 1", exchange: "BRVM", date: "2024-01-01", url: "http://example.com/1", summary: "..." },
    { title: "Article BRVM 2", exchange: "BRVM", date: "2024-01-02", url: "http://example.com/2", summary: "..." },
    { title: "Article JSE 1",  exchange: "JSE",  date: "2024-01-03", url: "http://example.com/3", summary: "..." },
    { title: "Article BRVM 3", exchange: "BRVM", date: "2024-01-04", url: "http://example.com/4", summary: "..." },
    { title: "Article EGX 1",  exchange: "EGX",  date: "2024-01-05", url: "http://example.com/5", summary: "..." },
  ]),
}));

import { getMarketNews } from "./market-news.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockFetcher(): Pick<Fetcher, "fetchPage"> {
  return { fetchPage: vi.fn().mockResolvedValue("<html><body></body></html>") };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("getMarketNews", () => {
  let fetcher: ReturnType<typeof makeMockFetcher>;

  beforeEach(() => {
    fetcher = makeMockFetcher();
    vi.clearAllMocks();
  });

  // ── Routing ────────────────────────────────────────────────────────────

  describe("routing fetchPage", () => {
    it("sans exchange — fetch la homepage (chemin vide)", async () => {
      await getMarketNews({ limit: 10 }, fetcher as Fetcher);

      // L'appel doit utiliser "" (homepage) et non une URL exchange
      expect(fetcher.fetchPage).toHaveBeenCalledWith("", 600);
    });

    it("avec exchange valide (BRVM) — fetch la page de la bourse", async () => {
      await getMarketNews({ exchange: "BRVM", limit: 10 }, fetcher as Fetcher);

      expect(fetcher.fetchPage).toHaveBeenCalledWith(
        expect.stringContaining("/bourse/brvm"),
        600
      );
    });

    it("exchange inconnu — fetch tout de même (homepage fallback)", async () => {
      await getMarketNews({ exchange: "FAKEX", limit: 10 }, fetcher as Fetcher);

      // Retourne "" si l'exchange n'est pas trouvé
      expect(fetcher.fetchPage).toHaveBeenCalledWith("", 600);
    });
  });

  // ── Limite ─────────────────────────────────────────────────────────────

  describe("limite d'articles", () => {
    it("respecte la limite passée en paramètre", async () => {
      const result = await getMarketNews({ limit: 2 }, fetcher as Fetcher);

      expect(result.articles).toHaveLength(2);
      expect(result.count).toBe(2);
    });

    it("retourne tous les articles si la limite dépasse le nombre disponible", async () => {
      const result = await getMarketNews({ limit: 50 }, fetcher as Fetcher);

      expect(result.articles).toHaveLength(5);
    });
  });

  // ── Structure du résultat ──────────────────────────────────────────────

  describe("structure du résultat", () => {
    it("sans exchange — exchange='all' dans la réponse", async () => {
      const result = await getMarketNews({ limit: 10 }, fetcher as Fetcher);

      expect(result.exchange).toBe("all");
    });

    it("avec exchange — le code exchange est retourné dans la réponse", async () => {
      const result = await getMarketNews({ exchange: "BRVM", limit: 10 }, fetcher as Fetcher);

      expect(result.exchange).toBe("BRVM");
    });

    it("retourne count et articles cohérents", async () => {
      const result = await getMarketNews({ limit: 3 }, fetcher as Fetcher);

      expect(result.count).toBe(result.articles.length);
    });
  });
});
