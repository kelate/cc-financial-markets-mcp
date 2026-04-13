import { describe, expect, it, vi } from "vitest";
import { getAnnualReports } from "./annual-reports.js";
import type { Fetcher } from "../scraper/fetcher.js";

// Minimal HTML page with one report, one "Fin" pagination link, and a date
function makePage(opts: {
  symbol?: string;
  docType?: string;
  date?: string;
  lastStart?: number;
} = {}): string {
  const symbol = opts.symbol ?? "BRVM";
  const docType = opts.docType ?? "Rapport annuel 2024";
  const date = opts.date ?? "01-15-2024";
  const finHref = opts.lastStart !== undefined
    ? `?layout=table&amp;start=${opts.lastStart}`
    : null;

  return `
    <table class="edocman_document_list">
      <tr>
        <td class="edocman-document-title-td">
          <a class="edocman_document_link"
             href="/fr/component/edocman/100/viewdocument/100"
             aria-label="${symbol} | ${docType}">${symbol} | ${docType}</a>
          <div class="dateinformation"><i class="edicon edicon-calendar"></i>&nbsp;${date}</div>
        </td>
        <td class="center edocman-table-download-col">
          <a href="/fr/bourse/brvm/publications/100/download" class="edocman-download-link">Télécharger</a>
        </td>
      </tr>
    </table>
    ${finHref ? `<div class="pagination"><a title="Fin" href="${finHref}">Fin</a></div>` : ""}
  `;
}

function makeMockFetcher(pages: Record<string, string> = {}): Fetcher {
  return {
    fetchPage: vi.fn(async (path: string, _ttl?: number, _force?: boolean) => {
      if (pages[path]) return pages[path];
      return makePage();
    }),
  } as unknown as Fetcher;
}

describe("getAnnualReports", () => {
  it("throws for unknown exchange", async () => {
    const fetcher = makeMockFetcher();
    await expect(getAnnualReports({ exchange: "UNKNOWN", page: 1, pages: 1, force_refresh: false }, fetcher))
      .rejects.toThrow("Place de marché inconnue");
  });

  it("fetches page 1 by default (start=0)", async () => {
    const fetcher = makeMockFetcher();
    const fetchSpy = vi.spyOn(fetcher, "fetchPage");

    await getAnnualReports({ exchange: "BRVM", page: 1, pages: 1, force_refresh: false }, fetcher);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toContain("start=0");
  });

  it("fetches page 2 → URL with start=10", async () => {
    const fetcher = makeMockFetcher();
    const fetchSpy = vi.spyOn(fetcher, "fetchPage");

    await getAnnualReports({ exchange: "BRVM", page: 2, pages: 1, force_refresh: false }, fetcher);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toContain("start=10");
  });

  it("pages=2 triggers 2 fetches (start=0 and start=10)", async () => {
    const fetcher = makeMockFetcher();
    const fetchSpy = vi.spyOn(fetcher, "fetchPage");

    await getAnnualReports({ exchange: "BRVM", page: 1, pages: 2, force_refresh: false }, fetcher);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toContain("start=0");
    expect(fetchSpy.mock.calls[1][0]).toContain("start=10");
  });

  it("force_refresh passes true as 3rd arg to fetchPage", async () => {
    const fetcher = makeMockFetcher();
    const fetchSpy = vi.spyOn(fetcher, "fetchPage");

    await getAnnualReports({ exchange: "BRVM", page: 1, pages: 1, force_refresh: true }, fetcher);

    expect(fetchSpy.mock.calls[0][2]).toBe(true);
  });

  it("force_refresh=false passes false as 3rd arg to fetchPage", async () => {
    const fetcher = makeMockFetcher();
    const fetchSpy = vi.spyOn(fetcher, "fetchPage");

    await getAnnualReports({ exchange: "BRVM", page: 1, pages: 1, force_refresh: false }, fetcher);

    expect(fetchSpy.mock.calls[0][2]).toBe(false);
  });

  it("extracts totalPages from HTML and returns correct pagination", async () => {
    const html = makePage({ lastStart: 2020 }); // totalPages = floor(2020/10)+1 = 203
    const fetcher = makeMockFetcher({ "/bourse/brvm/publications?layout=table&start=0": html });

    const result = await getAnnualReports({ exchange: "BRVM", page: 1, pages: 1, force_refresh: false }, fetcher);

    expect(result.pagination.totalPages).toBe(203);
    expect(result.pagination.currentPage).toBe(1);
    expect(result.pagination.pagesRequested).toBe(1);
    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.nextPage).toBe(2);
  });

  it("hasMore=false when on last page", async () => {
    const html = makePage({ lastStart: 0 }); // only 1 page
    const fetcher = makeMockFetcher({ "/bourse/brvm/publications?layout=table&start=0": html });

    const result = await getAnnualReports({ exchange: "BRVM", page: 1, pages: 1, force_refresh: false }, fetcher);

    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.nextPage).toBeNull();
  });

  it("filters by document_type (case-insensitive partial match)", async () => {
    const pages: Record<string, string> = {
      "/bourse/brvm/publications?layout=table&start=0": `
        <table class="edocman_document_list">
          <tr>
            <td class="edocman-document-title-td">
              <a class="edocman_document_link" href="/fr/component/edocman/1/viewdocument/1"
                 aria-label="ORAC | Notation financière">ORAC | Notation financière</a>
              <div class="dateinformation"><i></i>&nbsp;02-03-2026</div>
            </td>
            <td><a href="/fr/bourse/brvm/publications/1/download" class="edocman-download-link">DL</a></td>
          </tr>
          <tr>
            <td class="edocman-document-title-td">
              <a class="edocman_document_link" href="/fr/component/edocman/2/viewdocument/2"
                 aria-label="SGBC | Rapport annuel 2024">SGBC | Rapport annuel 2024</a>
              <div class="dateinformation"><i></i>&nbsp;01-15-2024</div>
            </td>
            <td><a href="/fr/bourse/brvm/publications/2/download" class="edocman-download-link">DL</a></td>
          </tr>
        </table>
      `,
    };
    const fetcher = makeMockFetcher(pages);

    const result = await getAnnualReports({
      exchange: "BRVM",
      document_type: "notation",
      page: 1,
      pages: 1,
      force_refresh: false,
    }, fetcher);

    expect(result.count).toBe(1);
    expect(result.reports[0].symbol).toBe("ORAC");
    expect(result.reports[0].documentType).toBe("Notation financière");
  });

  it("filters by year", async () => {
    const fetcher = makeMockFetcher({
      "/bourse/brvm/publications?layout=table&start=0": makePage({ docType: "Rapport 2023", date: "06-01-2023" }),
    });

    const result = await getAnnualReports({ exchange: "BRVM", year: 2024, page: 1, pages: 1, force_refresh: false }, fetcher);

    expect(result.count).toBe(0);
  });

  it("filters by company name (partial, case-insensitive)", async () => {
    const pages: Record<string, string> = {
      "/bourse/brvm/publications?layout=table&start=0": `
        <table class="edocman_document_list">
          <tr>
            <td class="edocman-document-title-td">
              <a class="edocman_document_link" href="/fr/component/edocman/1/viewdocument/1">SONATEL | Rapport 2024</a>
            </td>
            <td><a href="/fr/bourse/brvm/publications/1/download" class="edocman-download-link">DL</a></td>
          </tr>
          <tr>
            <td class="edocman-document-title-td">
              <a class="edocman_document_link" href="/fr/component/edocman/2/viewdocument/2">ORAC | Notation 2024</a>
            </td>
            <td><a href="/fr/bourse/brvm/publications/2/download" class="edocman-download-link">DL</a></td>
          </tr>
        </table>
      `,
    };
    const fetcher = makeMockFetcher(pages);

    const result = await getAnnualReports({
      exchange: "BRVM",
      company: "sonatel",
      page: 1,
      pages: 1,
      force_refresh: false,
    }, fetcher);

    expect(result.count).toBe(1);
    expect(result.reports[0].symbol).toBe("SONATEL");
  });

  it("returns exchange info and filters in result", async () => {
    const fetcher = makeMockFetcher();
    const result = await getAnnualReports({ exchange: "BRVM", page: 1, pages: 1, force_refresh: false }, fetcher);

    expect(result.exchange.code).toBe("BRVM");
    expect(result.exchange.name).toBeTruthy();
    expect(result.filters.page).toBe(1);
    expect(result.filters.pages).toBe(1);
  });

  it("merges reports from multiple pages", async () => {
    const fetcher = makeMockFetcher(); // each call returns 1 report
    const result = await getAnnualReports({ exchange: "BRVM", page: 1, pages: 3, force_refresh: false }, fetcher);
    expect(result.count).toBe(3); // 1 report per page × 3 pages
  });

  it("TTL passed to fetchPage is 3600", async () => {
    const fetcher = makeMockFetcher();
    const fetchSpy = vi.spyOn(fetcher, "fetchPage");

    await getAnnualReports({ exchange: "BRVM", page: 1, pages: 1, force_refresh: false }, fetcher);

    expect(fetchSpy.mock.calls[0][1]).toBe(3600);
  });
});
