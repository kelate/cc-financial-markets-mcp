/**
 * Tests for get_company_documents tool.
 */

import { describe, expect, it, vi } from "vitest";
import { getCompanyDocuments } from "./company-documents.js";
import type { Fetcher } from "../scraper/fetcher.js";

// Minimal HTML with paywall message
const PAYWALL_HTML = `
<html><body>
<h2>SDSC</h2>
<p><center><h1><i class="fa fa-lock"></i> Abonnez-vous pour un accès illimité.</h1></center></p>
</body></html>
`;

// HTML with press releases, annual reports, dividends
const PROFILE_HTML = `
<html><body>
<h2>Africa Global Logistics</h2>
<h3>About the company </h3>
<p>Description de l'entreprise.</p>

<h3>Competitors </h3>
<table class="edocman_document_list" style="width:100%">
  <tr>
    <td class="edocman_document_list_title2"><a href="/fr/bourse/brvm/listed-companies/company?code=SMBC">   SMB</a></td>
    <td style="text-align:right">11,900.00</td>
    <td style="text-align:right"><span style="color: #28a828;">+2.59%</span></td>
  </tr>
</table>

<table class="edocman_document_list" style="width:100%">
  <tr>
    <td class="edocman_document_list_title2">
      <i class="edicon edicon-file-pdf"></i>
      <a href="/fr/component/edocman/56114-sdsc-paiement-de-dividendes-3/viewdocument/56114 ">   SDSC | Paiement de dividendes</a>
    </td>
    <td style="text-align:right;font-size: 10pt; color: #999;">18 sept. 2025</td>
  </tr>
  <tr>
    <td class="edocman_document_list_title2">
      <i class="edicon edicon-file-pdf"></i>
      <a href="/fr/component/edocman/52067-sdsc-projet-de-texte-des-resolutions/viewdocument/52067 ">   SDSC | Projet de texte des résolutions</a>
    </td>
    <td style="text-align:right;font-size: 10pt; color: #999;">25 oct. 2024</td>
  </tr>
  <tr>
    <td class="edocman_document_list_title2">
      <i class="edicon edicon-file-pdf"></i>
      <a href="/fr/component/edocman/14475-sdsc-convocation/viewdocument/14475 ">   SDSC | Convocation à l'AGO</a>
    </td>
    <td style="text-align:right;font-size: 10pt; color: #999;"> 3 oct. 2023</td>
  </tr>
</table>

<h3>Analyse &amp; Recherche</h3>
<table class="edocman_document_list" style="width:100%">
  <tr>
    <td class="edocman_document_list_title2">
      <i class="edicon edicon-file-pdf"></i>
      <a href="https://hub.african-markets.com/reports/brvm/weekly-review" target="_blank">   BRVM | FGI Weekly Review</a>
    </td>
    <td style="text-align:right;font-size: 10pt; color: #999;">23 mars 2026</td>
  </tr>
</table>

<h3>Rapports Annuels &amp; Financiers</h3>
<table class="edocman_document_list" style="width:100%">
  <tr>
    <td class="edocman_document_list_title2">
      <i class="edicon edicon-file-pdf"></i>
      <a href="/fr/annual-reports?filter_Country=BRVM&filter_Year=2018&filter_Type=Annual Report&save_cta=1" target="_blank">Annual Report</a>
    </td>
    <td style="text-align:right;font-size: 10pt; color: #999;">2018</td>
  </tr>
  <tr>
    <td class="edocman_document_list_title2">
      <i class="edicon edicon-file-pdf"></i>
      <a href="/fr/annual-reports?filter_Country=BRVM&filter_Year=2015&filter_Type=Financial Statements&save_cta=1" target="_blank">Financial Statements</a>
    </td>
    <td style="text-align:right;font-size: 10pt; color: #999;">2015</td>
  </tr>
</table>

<table class="edocman_document_list" style="width:100%">
  <tr>
    <td class="edocman_document_list_title2" style="font-size: 12pt; font-weight: bold;">92 XOF</td>
    <td style="text-align:center;font-size: 10pt; color: #999;"></td>
    <td style="text-align:right;font-size: 10pt; color: #999;">20 nov. 2023</td>
  </tr>
  <tr>
    <td class="edocman_document_list_title2" style="font-size: 12pt; font-weight: bold;">130 XOF</td>
    <td style="text-align:center;font-size: 10pt; color: #999;"></td>
    <td style="text-align:right;font-size: 10pt; color: #999;">23 juin 2022</td>
  </tr>
</table>
</body></html>
`;

/** Create a mock fetcher that returns the given HTML */
function mockFetcher(html: string): Fetcher {
  return {
    fetchPage: vi.fn().mockResolvedValue(html),
  } as unknown as Fetcher;
}

describe("getCompanyDocuments", () => {
  it("throws for unknown exchange", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    await expect(
      getCompanyDocuments({ exchange: "INVALID", symbol: "SDSC", document_type: "all", force_refresh: false }, fetcher)
    ).rejects.toThrow(/Place de marché inconnue/);
    expect(fetcher.fetchPage).not.toHaveBeenCalled();
  });

  it("normalises symbol to uppercase", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    await getCompanyDocuments({ exchange: "BRVM", symbol: "sdsc", document_type: "all", force_refresh: false }, fetcher);
    expect(fetcher.fetchPage).toHaveBeenCalledWith(
      expect.stringContaining("SDSC"),
      expect.anything(),
      expect.anything()
    );
  });

  it("builds URL with the correct exchange slug and uppercase symbol", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    await getCompanyDocuments({ exchange: "BRVM", symbol: "sdsc", document_type: "all", force_refresh: false }, fetcher);
    expect(fetcher.fetchPage).toHaveBeenCalledWith(
      "/bourse/brvm/listed-companies/company?code=SDSC",
      1800,
      false
    );
  });

  it("throws paywall error with helpful message when paywall detected", async () => {
    const fetcher = mockFetcher(PAYWALL_HTML);
    await expect(
      getCompanyDocuments({ exchange: "BRVM", symbol: "SDSC", document_type: "all", force_refresh: false }, fetcher)
    ).rejects.toThrow(/Historique premium requis pour SDSC/);
  });

  it("passes force_refresh as the third argument to fetchPage", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    await getCompanyDocuments({ exchange: "BRVM", symbol: "SDSC", document_type: "all", force_refresh: true }, fetcher);
    expect(fetcher.fetchPage).toHaveBeenCalledWith(
      expect.any(String),
      1800,
      true
    );
  });

  it("returns the correct shape on success", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    const result = await getCompanyDocuments(
      { exchange: "BRVM", symbol: "SDSC", document_type: "all", force_refresh: false },
      fetcher
    );

    expect(result).toMatchObject({
      exchange: {
        name: "BRVM",
        code: "BRVM",
        country: "Côte d'Ivoire (UEMOA)",
        currency: "XOF",
      },
      symbol: "SDSC",
      company: "Africa Global Logistics",
      documentType: "all",
    });
    expect(typeof result.count).toBe("number");
    expect(Array.isArray(result.documents)).toBe(true);
    expect(result.count).toBe(result.documents.length);
  });

  it("each document has required fields", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    const result = await getCompanyDocuments(
      { exchange: "BRVM", symbol: "SDSC", document_type: "all", force_refresh: false },
      fetcher
    );

    for (const doc of result.documents) {
      expect(doc).toHaveProperty("type");
      expect(doc).toHaveProperty("title");
      expect(doc).toHaveProperty("url");
      expect(["annual_report", "financial_statement", "press_release", "dividend", "other"]).toContain(doc.type);
    }
  });

  it("filters documents by document_type=annual_report", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    const result = await getCompanyDocuments(
      { exchange: "BRVM", symbol: "SDSC", document_type: "annual_report", force_refresh: false },
      fetcher
    );

    expect(result.documentType).toBe("annual_report");
    expect(result.documents.every((d) => d.type === "annual_report")).toBe(true);
    expect(result.count).toBe(result.documents.length);
  });

  it("filters documents by document_type=press_release", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    const result = await getCompanyDocuments(
      { exchange: "BRVM", symbol: "SDSC", document_type: "press_release", force_refresh: false },
      fetcher
    );

    expect(result.documentType).toBe("press_release");
    expect(result.documents.every((d) => d.type === "press_release")).toBe(true);
  });

  it("filters documents by document_type=dividend", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    const result = await getCompanyDocuments(
      { exchange: "BRVM", symbol: "SDSC", document_type: "dividend", force_refresh: false },
      fetcher
    );

    expect(result.documentType).toBe("dividend");
    expect(result.documents.every((d) => d.type === "dividend")).toBe(true);
  });

  it("parses press releases with pdf fileType", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    const result = await getCompanyDocuments(
      { exchange: "BRVM", symbol: "SDSC", document_type: "press_release", force_refresh: false },
      fetcher
    );

    const docsWithUrl = result.documents.filter((d) => d.url);
    expect(docsWithUrl.length).toBeGreaterThan(0);
    for (const doc of docsWithUrl) {
      expect(doc.url).toMatch(/^https?:\/\//);
    }
  });

  it("parses annual reports with correct type", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    const result = await getCompanyDocuments(
      { exchange: "BRVM", symbol: "SDSC", document_type: "annual_report", force_refresh: false },
      fetcher
    );

    expect(result.documents.length).toBeGreaterThan(0);
    const annualReport = result.documents.find((d) => d.title === "Annual Report");
    expect(annualReport).toBeDefined();
    expect(annualReport?.year).toBe(2018);
    expect(annualReport?.type).toBe("annual_report");
  });

  it("parses financial statements", async () => {
    const fetcher = mockFetcher(PROFILE_HTML);
    const result = await getCompanyDocuments(
      { exchange: "BRVM", symbol: "SDSC", document_type: "financial_statement", force_refresh: false },
      fetcher
    );

    expect(result.documents.length).toBeGreaterThan(0);
    const fs = result.documents.find((d) => d.title === "Financial Statements");
    expect(fs).toBeDefined();
    expect(fs?.year).toBe(2015);
    expect(fs?.type).toBe("financial_statement");
  });

  it("returns empty documents list when filter matches nothing", async () => {
    // HTML with no dividend info
    const noDocsHtml = `<html><body><h2>TestCo</h2><p>Some content without documents</p></body></html>`;
    const fetcher = mockFetcher(noDocsHtml);
    const result = await getCompanyDocuments(
      { exchange: "BRVM", symbol: "XYZ", document_type: "dividend", force_refresh: false },
      fetcher
    );

    expect(result.count).toBe(0);
    expect(result.documents).toEqual([]);
  });
});
