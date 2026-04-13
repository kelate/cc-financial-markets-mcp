import { describe, expect, it } from "vitest";
import { parseMarketIndices, parseMarketNews, parseMovers, parseNumber, parsePublications, parseStockTable } from "./parser.js";

describe("parseNumber", () => {
  it("parses simple integers", () => {
    expect(parseNumber("1234")).toBe(1234);
  });

  it("parses French-formatted decimals (comma)", () => {
    expect(parseNumber("1 234,56")).toBe(1234.56);
  });

  it("parses English-formatted decimals (dot)", () => {
    expect(parseNumber("1,234.56")).toBe(1234.56);
  });

  it("handles negative values", () => {
    expect(parseNumber("-5,32")).toBe(-5.32);
  });

  it("handles percentage signs and other symbols", () => {
    expect(parseNumber("+2.5%")).toBe(2.5);
  });

  it("returns 0 for non-numeric strings", () => {
    expect(parseNumber("N/A")).toBe(0);
    expect(parseNumber("")).toBe(0);
    expect(parseNumber("-")).toBe(0);
  });
});

describe("parseStockTable", () => {
  it("extracts stock quotes from listed-companies table", () => {
    const html = `
      <table class="tabtable-rs_01k0jris">
        <tr><th>Company</th><th>Sector</th><th>Price</th><th>1D</th><th>YTD</th><th>M.Cap</th><th>Date</th></tr>
        <tr>
          <td><a href="/fr/bourse/brvm/listed-companies/company?code=SNTS">SONATEL</a></td>
          <td>Telecom</td><td>28,800</td><td>+1.33%</td><td>+12.5%</td><td>4,608</td><td>10/04</td>
        </tr>
        <tr>
          <td><a href="/fr/bourse/brvm/listed-companies/company?code=SGBC">SGB CI</a></td>
          <td>Financials</td><td>8,500</td><td>-0.58%</td><td>+5.2%</td><td>340</td><td>10/04</td>
        </tr>
      </table>
    `;
    const quotes = parseStockTable(html, "BRVM");
    expect(quotes).toHaveLength(2);
    expect(quotes[0].symbol).toBe("SNTS");
    expect(quotes[0].name).toBe("SONATEL");
    expect(quotes[0].price).toBe(28800);
    expect(quotes[0].changePercent).toBe(1.33);
    expect(quotes[0].exchange).toBe("BRVM");
    expect(quotes[1].symbol).toBe("SGBC");
  });

  it("skips rows with only 1 cell", () => {
    const html = `
      <table class="tabtable-rs_01k0jris">
        <tr><th>Company</th><th>Sector</th><th>Price</th><th>1D</th><th>YTD</th><th>M.Cap</th></tr>
        <tr><td>orphan</td></tr>
        <tr><td>SONATEL</td><td>Telecom</td><td>28800</td><td>+1.33%</td><td>+12%</td><td>4608</td></tr>
      </table>
    `;
    const quotes = parseStockTable(html, "BRVM");
    expect(quotes).toHaveLength(1);
  });

  it("returns empty array for non-matching HTML", () => {
    const html = "<div>No table here</div>";
    expect(parseStockTable(html, "BRVM")).toEqual([]);
  });
});

describe("parseMovers", () => {
  it("parses gainers, losers, and most active tables", () => {
    const html = `
      <table class="tabtable-rs_y3dom0sl">
        <tr><td><a href="?code=SAFC">Alios Finance</a></td><td>7,435</td><td>+6.21%</td><td>10/04</td></tr>
        <tr><td><a href="?code=CABC">SICABLE</a></td><td>4,340</td><td>+5.98%</td><td>10/04</td></tr>
      </table>
      <table class="tabtable-rs_y3dom0sl">
        <tr><td><a href="?code=SCRC">Sucrivoire</a></td><td>2,025</td><td>-4.71%</td><td>10/04</td></tr>
      </table>
      <table class="tabtable-rs_y3dom0sl">
        <tr><td><a href="?code=ETIT">Ecobank</a></td><td>34</td><td>756,768</td><td>10/04</td></tr>
      </table>
    `;
    const { gainers, losers, mostActive } = parseMovers(html, "BRVM");
    expect(gainers).toHaveLength(2);
    expect(gainers[0].symbol).toBe("SAFC");
    expect(gainers[0].changePercent).toBe(6.21);
    expect(losers).toHaveLength(1);
    expect(losers[0].changePercent).toBe(-4.71);
    expect(mostActive).toHaveLength(1);
    expect(mostActive[0].volume).toBe(756768);
  });
});

describe("parseMarketIndices", () => {
  it("parses indices from the standard table", () => {
    const html = `
      <table class="tabtable-rs_m316x72x">
        <tr>
          <td></td><td><a href="/fr/bourse/brvm">BRVM-CI</a></td><td>406.38</td><td>-0.14%</td><td>10/04</td>
        </tr>
        <tr>
          <td></td><td><a href="/fr/bourse/jse">JSE ASI</a></td><td>119,025.13</td><td>+0.69%</td><td>10/04</td>
        </tr>
      </table>
    `;
    const indices = parseMarketIndices(html);
    expect(indices).toHaveLength(2);
    expect(indices[0].name).toBe("BRVM-CI");
    expect(indices[0].value).toBe(406.38);
    expect(indices[0].exchange).toBe("BRVM");
    expect(indices[1].name).toBe("JSE ASI");
    expect(indices[1].value).toBe(119025.13);
    expect(indices[1].exchange).toBe("JSE");
  });
});

describe("parsePublications", () => {
  it("parses edocman publications table", () => {
    const html = `
      <table class="edocman_document_list">
        <tr>
          <td class="edocman-document-title-td">
            <a class="edocman_document_link" href="/fr/component/edocman/58467-brvm-resultats/viewdocument/58467">BRVM | Résultats de première cotation TPBJ</a>
          </td>
          <td class="center edocman-table-download-col">
            <a class="edocman-download-link" href="/fr/bourse/brvm/publications/58467/download">Télécharger (pdf)</a>
          </td>
        </tr>
        <tr>
          <td class="edocman-document-title-td">
            <a class="edocman_document_link" href="/fr/component/edocman/58466-sphc/viewdocument/58466">SPHC | Communiqué</a>
          </td>
          <td class="center edocman-table-download-col">
            <a class="edocman-download-link" href="/fr/bourse/brvm/publications/58466/download">Télécharger</a>
          </td>
        </tr>
      </table>
    `;
    const reports = parsePublications(html, "BRVM");
    expect(reports).toHaveLength(2);
    expect(reports[0].symbol).toBe("BRVM");
    expect(reports[0].title).toBe("Résultats de première cotation TPBJ");
    expect(reports[0].url).toContain("download");
    expect(reports[1].symbol).toBe("SPHC");
    expect(reports[1].title).toBe("Communiqué");
  });
});

describe("parseMarketNews", () => {
  it("parses raxo articles from homepage", () => {
    const html = `
      <article class="raxo-item-top raxo-category-id91"><div class="raxo-wrap">
        <h3><a href="/fr/bourse/brvm/brvm-en-hausse">La BRVM en hausse</a></h3>
        <span class="raxo-date">avril 11, 2026</span>
        <p>Le marché a connu une hausse significative.</p>
      </div></article>
      <article class="raxo-item-nor raxo-category-id82"><div class="raxo-wrap">
        <h3><a href="/fr/actualite/afrique-de-l-est/kenya/news">Kenya update</a></h3>
        <span class="raxo-date">Avr 10, 2026</span>
      </div></article>
    `;
    const news = parseMarketNews(html);
    expect(news).toHaveLength(2);
    expect(news[0].title).toBe("La BRVM en hausse");
    expect(news[0].url).toContain("/brvm/brvm-en-hausse");
    expect(news[0].exchange).toBe("BRVM");
    expect(news[0].date).toBe("avril 11, 2026");
    expect(news[1].title).toBe("Kenya update");
    expect(news[1].exchange).toBeUndefined(); // /actualite/ path, not /bourse/
  });

  it("limits summary length", () => {
    const longText = "A".repeat(1000);
    const html = `<article class="raxo-item-top"><div class="raxo-wrap"><h3><a href="/x">Title</a></h3><p>${longText}</p></div></article>`;
    const news = parseMarketNews(html);
    expect(news[0].summary.length).toBeLessThanOrEqual(500);
  });
});
