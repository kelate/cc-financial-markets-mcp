/**
 * Tests unitaires pour getAnnualReports
 * Couvre : validation exchange, filtres année/entreprise, structure du résultat
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Fetcher } from "../scraper/fetcher.js";

// Mock du parseur — retourne des rapports de test connus
vi.mock("../scraper/parser.js", () => ({
  parsePublications: vi.fn().mockReturnValue([
    { symbol: "SNTS", company: "Sonatel", year: 2023, title: "Rapport annuel 2023", url: "http://example.com/1", type: "PDF" },
    { symbol: "SNTS", company: "Sonatel", year: 2022, title: "Rapport annuel 2022", url: "http://example.com/2", type: "PDF" },
    { symbol: "ETIT", company: "Ecobank CI", year: 2023, title: "Rapport annuel 2023", url: "http://example.com/3", type: "PDF" },
    { symbol: "SGBC", company: "SGB CI", year: 2021, title: "Rapport annuel 2021", url: "http://example.com/4", type: "PDF" },
  ]),
}));

import { getAnnualReports } from "./annual-reports.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockFetcher(): Pick<Fetcher, "fetchPage"> {
  return { fetchPage: vi.fn().mockResolvedValue("<html><body></body></html>") };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("getAnnualReports", () => {
  let fetcher: ReturnType<typeof makeMockFetcher>;

  beforeEach(() => {
    fetcher = makeMockFetcher();
    vi.clearAllMocks();
  });

  // ── Validation ─────────────────────────────────────────────────────────

  describe("validation des exchanges", () => {
    it("lève une erreur pour un code exchange inconnu", async () => {
      await expect(
        getAnnualReports({ exchange: "INVALID" }, fetcher as Fetcher)
      ).rejects.toThrow('Place de marché inconnue: "INVALID"');
    });

    it("fetch la page publications avec TTL long (3600s)", async () => {
      await getAnnualReports({ exchange: "BRVM" }, fetcher as Fetcher);

      expect(fetcher.fetchPage).toHaveBeenCalledWith(
        expect.stringContaining("publications"),
        3600
      );
    });
  });

  // ── Filtres ────────────────────────────────────────────────────────────

  describe("filtres", () => {
    it("retourne tous les rapports sans filtre", async () => {
      const result = await getAnnualReports({ exchange: "BRVM" }, fetcher as Fetcher);

      expect(result.count).toBe(4);
      expect(result.reports).toHaveLength(4);
    });

    it("filtre par année exacte", async () => {
      const result = await getAnnualReports({ exchange: "BRVM", year: 2023 }, fetcher as Fetcher);

      expect(result.count).toBe(2);
      result.reports.forEach((r) => expect(r.year).toBe(2023));
    });

    it("filtre par nom d'entreprise (recherche partielle insensible à la casse)", async () => {
      const result = await getAnnualReports(
        { exchange: "BRVM", company: "ecobank" },
        fetcher as Fetcher
      );

      expect(result.count).toBe(1);
      expect(result.reports[0].company).toBe("Ecobank CI");
    });

    it("filtre par symbole de l'action (insensible à la casse)", async () => {
      const result = await getAnnualReports(
        { exchange: "BRVM", company: "sgbc" },
        fetcher as Fetcher
      );

      expect(result.count).toBe(1);
      expect(result.reports[0].symbol).toBe("SGBC");
    });

    it("combine filtre année et entreprise", async () => {
      const result = await getAnnualReports(
        { exchange: "BRVM", year: 2023, company: "sonatel" },
        fetcher as Fetcher
      );

      expect(result.count).toBe(1);
      expect(result.reports[0].year).toBe(2023);
      expect(result.reports[0].company).toBe("Sonatel");
    });

    it("retourne count=0 quand aucun rapport ne correspond", async () => {
      const result = await getAnnualReports(
        { exchange: "BRVM", year: 1990 },
        fetcher as Fetcher
      );

      expect(result.count).toBe(0);
      expect(result.reports).toHaveLength(0);
    });
  });

  // ── Structure du résultat ──────────────────────────────────────────────

  describe("structure du résultat", () => {
    it("contient les métadonnées de l'exchange et les filtres appliqués", async () => {
      const result = await getAnnualReports(
        { exchange: "BRVM", year: 2023, company: "sonatel" },
        fetcher as Fetcher
      );

      expect(result.exchange).toMatchObject({
        code: "BRVM",
        name: expect.any(String),
        country: expect.any(String),
      });
      expect(result.filters).toEqual({ year: 2023, company: "sonatel" });
    });
  });
});
