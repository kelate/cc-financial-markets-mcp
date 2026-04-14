/**
 * Tests for getStockHistory tool and parseStockHistory parser.
 */

import { describe, expect, it, vi } from "vitest";
import { getStockHistory } from "./stock-history.js";
import { parseStockHistory } from "../scraper/stock-history-parser.js";
import type { Fetcher } from "../scraper/fetcher.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal mock Fetcher
// ---------------------------------------------------------------------------

function mockFetcher(html: string): Fetcher {
  return {
    fetchPage: vi.fn().mockResolvedValue(html),
  } as unknown as Fetcher;
}

// ---------------------------------------------------------------------------
// Helper: build minimal HTML with chartData variable
// ---------------------------------------------------------------------------

function htmlWithChartData(points: object[]): string {
  return `<html><body>
    <h2>Test Company</h2>
    <script>
      var chartData = ${JSON.stringify(points)};
    </script>
  </body></html>`;
}

const SAMPLE_POINTS = [
  { date: "2024-01-05", open: 100, high: 110, low: 95, close: 105, volume: 1000 },
  { date: "2024-03-10", open: 105, high: 115, low: 100, close: 112, volume: 1500 },
  { date: "2024-06-15", open: 112, high: 120, low: 108, close: 118, volume: 2000 },
  { date: "2025-01-20", open: 118, high: 125, low: 115, close: 122, volume: 1800 },
  { date: "2025-04-01", open: 122, high: 130, low: 119, close: 128, volume: 2200 },
];

// ---------------------------------------------------------------------------
// parseStockHistory unit tests
// ---------------------------------------------------------------------------

describe("parseStockHistory", () => {
  it("returns [] when French paywall message is present", () => {
    const html = `<html><body><h1>Abonnez-vous pour un accès illimité.</h1></body></html>`;
    expect(parseStockHistory(html)).toEqual([]);
  });

  it("returns [] when English paywall button class is present", () => {
    const html = `<html><body><a class="btn btn-primary btn-singup" href="/en/subscribe">Subscribe</a></body></html>`;
    expect(parseStockHistory(html)).toEqual([]);
  });

  it("returns [] when no chartData variable is found", () => {
    const html = `<html><body><p>Some content</p></body></html>`;
    expect(parseStockHistory(html)).toEqual([]);
  });

  it("returns [] when chartData is an empty array", () => {
    const html = htmlWithChartData([]);
    expect(parseStockHistory(html)).toEqual([]);
  });

  it("parses valid OHLCV points correctly", () => {
    const html = htmlWithChartData([
      { date: "2024-06-01", open: 100, high: 110, low: 90, close: 105, volume: 5000 },
    ]);
    const result = parseStockHistory(html);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      date: "2024-06-01",
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 5000,
    });
  });

  it("converts French date format DD/MM/YYYY to YYYY-MM-DD", () => {
    const html = htmlWithChartData([
      { date: "15/06/2024", close: 200 },
    ]);
    const result = parseStockHistory(html);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2024-06-15");
  });

  it("skips entries with missing or zero close price", () => {
    const html = htmlWithChartData([
      { date: "2024-01-01", close: 0 },
      { date: "2024-01-02", close: 100 },
      { date: "2024-01-03" },
    ]);
    const result = parseStockHistory(html);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2024-01-02");
  });

  it("sorts data points ascending by date", () => {
    const html = htmlWithChartData([
      { date: "2024-03-01", close: 100 },
      { date: "2024-01-01", close: 90 },
      { date: "2024-02-01", close: 95 },
    ]);
    const result = parseStockHistory(html);
    expect(result.map((p) => p.date)).toEqual([
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
    ]);
  });

  it("handles French-formatted numbers in close price", () => {
    const html = `<html><body>
      <script>var chartData = [{"date":"2024-01-01","close":"1 234,56"}];</script>
    </body></html>`;
    const result = parseStockHistory(html);
    expect(result).toHaveLength(1);
    expect(result[0].close).toBeCloseTo(1234.56);
  });

  it("omits optional fields when absent", () => {
    const html = htmlWithChartData([
      { date: "2024-05-01", close: 50 },
    ]);
    const result = parseStockHistory(html);
    expect(result[0]).not.toHaveProperty("open");
    expect(result[0]).not.toHaveProperty("high");
    expect(result[0]).not.toHaveProperty("low");
    expect(result[0]).not.toHaveProperty("volume");
  });
});

// ---------------------------------------------------------------------------
// getStockHistory integration tests (with mocked fetcher)
// ---------------------------------------------------------------------------

describe("getStockHistory", () => {
  it("throws for an unknown exchange code", async () => {
    const fetcher = mockFetcher("<html></html>");
    await expect(
      getStockHistory({ exchange: "UNKNOWN", symbol: "ABC", period: "1y", force_refresh: false }, fetcher)
    ).rejects.toThrow(/Place de marché inconnue/);
  });

  it("normalises symbol to uppercase", async () => {
    const html = htmlWithChartData(SAMPLE_POINTS);
    const fetcher = mockFetcher(html);
    const result = await getStockHistory(
      { exchange: "BRVM", symbol: "sdsc", period: "all", force_refresh: false },
      fetcher
    );
    expect(result.symbol).toBe("SDSC");
  });

  it("throws premium error when paywall detected", async () => {
    const html = `<html><body><h1>Abonnez-vous pour un accès illimité.</h1></body></html>`;
    const fetcher = mockFetcher(html);
    await expect(
      getStockHistory({ exchange: "BRVM", symbol: "SDSC", period: "1y", force_refresh: false }, fetcher)
    ).rejects.toThrow(/Données premium requises pour l'historique de SDSC/);
    await expect(
      getStockHistory({ exchange: "BRVM", symbol: "SDSC", period: "1y", force_refresh: false }, fetcher)
    ).rejects.toThrow(/AFRICAN_MARKETS_USERNAME/);
  });

  it("returns the correct exchange metadata", async () => {
    const html = htmlWithChartData(SAMPLE_POINTS);
    const fetcher = mockFetcher(html);
    const result = await getStockHistory(
      { exchange: "BRVM", symbol: "SDSC", period: "all", force_refresh: false },
      fetcher
    );
    expect(result.exchange.code).toBe("BRVM");
    expect(result.exchange.name).toBe("BRVM");
    expect(result.exchange.currency).toBe("XOF");
  });

  it("returns all data points for period=all", async () => {
    const html = htmlWithChartData(SAMPLE_POINTS);
    const fetcher = mockFetcher(html);
    const result = await getStockHistory(
      { exchange: "JSE", symbol: "NPN", period: "all", force_refresh: false },
      fetcher
    );
    expect(result.count).toBe(SAMPLE_POINTS.length);
    expect(result.dataPoints).toHaveLength(SAMPLE_POINTS.length);
  });

  it("filters correctly for period=1y (last 12 months)", async () => {
    // SAMPLE_POINTS has entries in 2024 (3 points) and 2025 (2 points).
    // "1y" should include points from ~1 year ago up to now (2026-04-13 in tests).
    // All 2024+ entries should be within 1 year of 2025/2026 dates.
    // The 2024-01-05 entry is more than 1 year before 2025-04-01 running date.
    // We test deterministically: only 2025 points are within 1y of a 2026 date.
    const now2025Points = [
      { date: "2025-01-20", close: 122 },
      { date: "2025-04-01", close: 128 },
    ];
    const oldPoints = [
      { date: "2020-01-01", close: 50 },
      { date: "2021-06-01", close: 60 },
    ];
    const html = htmlWithChartData([...oldPoints, ...now2025Points]);
    const fetcher = mockFetcher(html);
    const result = await getStockHistory(
      { exchange: "JSE", symbol: "NPN", period: "1y", force_refresh: false },
      fetcher
    );
    // All returned points should be within the last year
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const p of result.dataPoints) {
      expect(p.date >= cutoffStr).toBe(true);
    }
  });

  it("returns period and count in the result", async () => {
    const html = htmlWithChartData(SAMPLE_POINTS);
    const fetcher = mockFetcher(html);
    const result = await getStockHistory(
      { exchange: "JSE", symbol: "NPN", period: "all", force_refresh: false },
      fetcher
    );
    expect(result.period).toBe("all");
    expect(result.count).toBe(result.dataPoints.length);
  });

  it("passes forceRefresh=true to fetchPage when force_refresh=true", async () => {
    const html = htmlWithChartData(SAMPLE_POINTS);
    const fetcher = mockFetcher(html);
    await getStockHistory(
      { exchange: "BRVM", symbol: "SDSC", period: "all", force_refresh: true },
      fetcher
    );
    expect(fetcher.fetchPage).toHaveBeenCalledWith(
      expect.stringContaining("SDSC"),
      undefined,
      true
    );
  });

  it("passes forceRefresh=false to fetchPage when force_refresh=false", async () => {
    const html = htmlWithChartData(SAMPLE_POINTS);
    const fetcher = mockFetcher(html);
    await getStockHistory(
      { exchange: "BRVM", symbol: "SDSC", period: "all", force_refresh: false },
      fetcher
    );
    expect(fetcher.fetchPage).toHaveBeenCalledWith(
      expect.stringContaining("SDSC"),
      undefined,
      false
    );
  });

  it("constructs correct URL path from exchange slug and symbol", async () => {
    const html = htmlWithChartData(SAMPLE_POINTS);
    const fetcher = mockFetcher(html);
    await getStockHistory(
      { exchange: "JSE", symbol: "NPN", period: "all", force_refresh: false },
      fetcher
    );
    expect(fetcher.fetchPage).toHaveBeenCalledWith(
      "/bourse/jse/listed-companies/company?code=NPN",
      undefined,
      false
    );
  });
});
