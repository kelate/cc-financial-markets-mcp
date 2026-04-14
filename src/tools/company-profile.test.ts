/**
 * Tests unitaires pour getCompanyProfile
 * Couvre : validation exchange, détection premium, parsing HTML (ISIN, nom, sections)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Fetcher } from "../scraper/fetcher.js";
import { getCompanyProfile } from "./company-profile.js";

// ── Fixtures HTML ──────────────────────────────────────────────────────────

const PREMIUM_HTML = `
<html><body>
<h2>Sonatel SA</h2>
<table>
  <tbody>
    <tr><td>ISIN CI0000000123</td><td></td></tr>
    <tr><td>Création 1985</td><td></td></tr>
    <tr><td>Cotation 1998</td><td></td></tr>
    <tr><td>Téléphone +225 20 23 40 00</td><td></td></tr>
  </tbody>
</table>

<h3>Rapports annuels</h3>
<table class="edocman_document_list">
  <tbody>
    <tr>
      <td>Rapport annuel 2023</td>
      <td>2023</td>
      <td><a href="/edocman/download/123.pdf">Télécharger</a></td>
    </tr>
    <tr>
      <td>Rapport annuel 2022</td>
      <td>2022</td>
      <td><a href="/edocman/download/122.pdf">Télécharger</a></td>
    </tr>
  </tbody>
</table>

<h3>Dividendes</h3>
<table class="edocman_document_list">
  <tbody>
    <tr><td>12500</td><td>2023-06-15</td></tr>
    <tr><td>11000</td><td>2022-06-10</td></tr>
  </tbody>
</table>

<h3>Communiqués</h3>
<table class="edocman_document_list">
  <tbody>
    <tr>
      <td><a class="edocman_document_link" href="/communique/456">Résultats Q1 2024</a></td>
      <td>2024-04-01</td>
    </tr>
  </tbody>
</table>
</body></html>`;

/** Page verrouillée — accès non-premium */
const NON_PREMIUM_HTML = `
<html><body>
<p>Abonnez-vous pour un accès illimité</p>
<h2>SNTS</h2>
</body></html>`;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockFetcher(html: string): Pick<Fetcher, "fetchPage"> {
  return { fetchPage: vi.fn().mockResolvedValue(html) };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("getCompanyProfile", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Validation ─────────────────────────────────────────────────────────

  describe("validation", () => {
    it("lève une erreur pour un code exchange inconnu", async () => {
      const fetcher = makeMockFetcher(PREMIUM_HTML);

      await expect(
        getCompanyProfile({ exchange: "INVALID", symbol: "SNTS" }, fetcher as Fetcher)
      ).rejects.toThrow('Place de marché inconnue: "INVALID"');
    });

    it("fetch la page company avec l'URL correcte (symbol en majuscules)", async () => {
      const fetcher = makeMockFetcher(PREMIUM_HTML);

      await getCompanyProfile({ exchange: "BRVM", symbol: "snts" }, fetcher as Fetcher);

      expect(fetcher.fetchPage).toHaveBeenCalledWith(
        expect.stringContaining("code=SNTS"),
        1800
      );
    });
  });

  // ── Détection premium ──────────────────────────────────────────────────

  describe("détection premium", () => {
    it("premium=true quand la page ne contient pas le message d'abonnement", async () => {
      const fetcher = makeMockFetcher(PREMIUM_HTML);

      const result = await getCompanyProfile({ exchange: "BRVM", symbol: "SNTS" }, fetcher as Fetcher);

      expect(result.premium).toBe(true);
    });

    it("premium=false quand la page contient 'Abonnez-vous pour un accès illimité'", async () => {
      const fetcher = makeMockFetcher(NON_PREMIUM_HTML);

      const result = await getCompanyProfile({ exchange: "BRVM", symbol: "SNTS" }, fetcher as Fetcher);

      expect(result.premium).toBe(false);
    });
  });

  // ── Parsing HTML ───────────────────────────────────────────────────────

  describe("parsing du contenu HTML", () => {
    it("extrait le nom de la société depuis le h2", async () => {
      const fetcher = makeMockFetcher(PREMIUM_HTML);

      const result = await getCompanyProfile({ exchange: "BRVM", symbol: "SNTS" }, fetcher as Fetcher);

      expect(result.company.name).toBe("Sonatel SA");
    });

    it("extrait l'ISIN depuis le tableau d'infos", async () => {
      const fetcher = makeMockFetcher(PREMIUM_HTML);

      const result = await getCompanyProfile({ exchange: "BRVM", symbol: "SNTS" }, fetcher as Fetcher);

      expect(result.company.isin).toBe("CI0000000123");
    });

    it("extrait l'année de création et de cotation", async () => {
      const fetcher = makeMockFetcher(PREMIUM_HTML);

      const result = await getCompanyProfile({ exchange: "BRVM", symbol: "SNTS" }, fetcher as Fetcher);

      expect(result.company.founded).toBe("1985");
      expect(result.company.listed).toBe("1998");
    });

    it("parse la section Rapports annuels (count et items)", async () => {
      const fetcher = makeMockFetcher(PREMIUM_HTML);

      const result = await getCompanyProfile({ exchange: "BRVM", symbol: "SNTS" }, fetcher as Fetcher);

      expect(result.annualReports.count).toBe(2);
      expect(result.annualReports.items[0].title).toBe("Rapport annuel 2023");
      expect(result.annualReports.items[0].year).toBe(2023);
      expect(result.annualReports.items[0].type).toBe("PDF");
    });

    it("parse la section Dividendes (montant > 0 requis)", async () => {
      const fetcher = makeMockFetcher(PREMIUM_HTML);

      const result = await getCompanyProfile({ exchange: "BRVM", symbol: "SNTS" }, fetcher as Fetcher);

      expect(result.dividends.count).toBe(2);
      expect(result.dividends.items[0].amount).toBe("12500");
      expect(result.dividends.items[0].date).toBe("2023-06-15");
    });

    it("parse la section Communiqués (titre et lien)", async () => {
      const fetcher = makeMockFetcher(PREMIUM_HTML);

      const result = await getCompanyProfile({ exchange: "BRVM", symbol: "SNTS" }, fetcher as Fetcher);

      expect(result.communiques.count).toBe(1);
      expect(result.communiques.items[0].title).toBe("Résultats Q1 2024");
    });

    it("retourne les métadonnées de l'exchange dans le résultat", async () => {
      const fetcher = makeMockFetcher(PREMIUM_HTML);

      const result = await getCompanyProfile({ exchange: "BRVM", symbol: "SNTS" }, fetcher as Fetcher);

      expect(result.exchange).toMatchObject({
        code: "BRVM",
        name: expect.any(String),
        country: expect.any(String),
        currency: expect.any(String),
      });
    });
  });
});
