import { describe, expect, it, vi } from "vitest";
import { parseIndexHistory } from "../scraper/index-history-parser.js";
import { getIndexHistory } from "./index-history.js";

// ---------------------------------------------------------------------------
// parseIndexHistory unit tests
// ---------------------------------------------------------------------------

describe("parseIndexHistory", () => {
  const makeHtml = (data: unknown) =>
    `<html><body><script>var chartData = ${JSON.stringify(data)};</script></body></html>`;

  it("returns empty array when chartData is absent", () => {
    expect(parseIndexHistory("<html><body></body></html>")).toEqual([]);
  });

  it("parses 5 data points correctly", () => {
    const raw = [
      { date: "2024-01-01", close: "100.00", volume: "1000" },
      { date: "2024-01-02", close: "102.50", volume: "2000" },
      { date: "2024-01-03", close: "101.00", volume: "1500" },
      { date: "2024-01-04", close: "103.75", volume: "3000" },
      { date: "2024-01-05", close: "105.00", volume: "2500" },
    ];
    const result = parseIndexHistory(makeHtml(raw));
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ date: "2024-01-01", close: 100.0, volume: 1000 });
    expect(result[1].close).toBe(102.5);
    expect(result[4].date).toBe("2024-01-05");
  });

  it("filters out entries with close <= 0", () => {
    const raw = [
      { date: "2024-01-01", close: "0", volume: "0" },
      { date: "2024-01-02", close: "-5.00", volume: "100" },
      { date: "2024-01-03", close: "200.00", volume: "500" },
    ];
    const result = parseIndexHistory(makeHtml(raw));
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2024-01-03");
  });

  it("returns data sorted by date ascending", () => {
    const raw = [
      { date: "2024-03-01", close: "300.00", volume: "0" },
      { date: "2024-01-01", close: "100.00", volume: "0" },
      { date: "2024-02-01", close: "200.00", volume: "0" },
    ];
    const result = parseIndexHistory(makeHtml(raw));
    expect(result.map((p) => p.date)).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
  });

  it("returns empty array for malformed JSON", () => {
    const html = `<script>var chartData = [{bad json</script>`;
    expect(parseIndexHistory(html)).toEqual([]);
  });

  it("handles volume as 0 when missing", () => {
    const raw = [{ date: "2024-01-01", close: "100.00" }];
    const result = parseIndexHistory(makeHtml(raw));
    expect(result[0].volume).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getIndexHistory tool tests
// ---------------------------------------------------------------------------

/** Build a minimal mock Fetcher with a controllable fetchPage. */
function makeFetcher(html: string) {
  const fetchPage = vi.fn().mockResolvedValue(html);
  return { fetchPage };
}

/** Generate HTML containing chartData with `n` daily points ending today. */
function makeChartHtml(points: Array<{ date: string; close: string; volume: string }>) {
  return `<html><body><script>var chartData = ${JSON.stringify(points)};</script></body></html>`;
}

/** Produce a date string `daysAgo` days before today in YYYY-MM-DD format. */
function dateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

describe("getIndexHistory", () => {
  it("throws for unknown exchange code", async () => {
    const fetcher = makeFetcher("<html></html>");
    await expect(
      getIndexHistory({ exchange: "UNKNOWN", period: "1y", force_refresh: false }, fetcher as never)
    ).rejects.toThrow(/Place de marché inconnue/);
  });

  it("returns exchange metadata in the result", async () => {
    const html = makeChartHtml([
      { date: dateOffset(10), close: "400.00", volume: "1000" },
    ]);
    const fetcher = makeFetcher(html);
    const result = await getIndexHistory(
      { exchange: "BRVM", period: "1y", force_refresh: false },
      fetcher as never
    );
    expect(result.exchange.code).toBe("BRVM");
    expect(result.exchange.name).toBe("BRVM");
    expect(result.exchange.currency).toBe("XOF");
    expect(result.period).toBe("1y");
  });

  it("filters data points by period=1m (keeps only last 30 days)", async () => {
    const points = [
      { date: dateOffset(200), close: "100.00", volume: "100" }, // too old
      { date: dateOffset(20), close: "200.00", volume: "200" },  // within 1m
      { date: dateOffset(5), close: "210.00", volume: "300" },   // within 1m
    ];
    const fetcher = makeFetcher(makeChartHtml(points));
    const result = await getIndexHistory(
      { exchange: "BRVM", period: "1m", force_refresh: false },
      fetcher as never
    );
    expect(result.count).toBe(2);
    expect(result.dataPoints.every((p) => p.close > 0)).toBe(true);
  });

  it("returns all data points when period=all", async () => {
    const points = [
      { date: "2015-04-14", close: "258.79", volume: "0" },
      { date: "2018-06-01", close: "300.00", volume: "500" },
      { date: dateOffset(5), close: "404.04", volume: "535034" },
    ];
    const fetcher = makeFetcher(makeChartHtml(points));
    const result = await getIndexHistory(
      { exchange: "BRVM", period: "all", force_refresh: false },
      fetcher as never
    );
    expect(result.count).toBe(3);
  });

  it("filters data points by period=1y (keeps only last 365 days)", async () => {
    const points = [
      { date: dateOffset(400), close: "100.00", volume: "0" }, // too old
      { date: dateOffset(180), close: "200.00", volume: "0" }, // within 1y
      { date: dateOffset(10), close: "210.00", volume: "0" },  // within 1y
    ];
    const fetcher = makeFetcher(makeChartHtml(points));
    const result = await getIndexHistory(
      { exchange: "JSE", period: "1y", force_refresh: false },
      fetcher as never
    );
    expect(result.count).toBe(2);
  });

  it("passes forceRefresh=true to fetchPage when force_refresh=true", async () => {
    const html = makeChartHtml([{ date: dateOffset(1), close: "100.00", volume: "0" }]);
    const fetcher = makeFetcher(html);
    await getIndexHistory(
      { exchange: "BRVM", period: "all", force_refresh: true },
      fetcher as never
    );
    expect(fetcher.fetchPage).toHaveBeenCalledWith("/bourse/brvm", undefined, true);
  });

  it("passes forceRefresh=false to fetchPage when force_refresh=false", async () => {
    const html = makeChartHtml([{ date: dateOffset(1), close: "100.00", volume: "0" }]);
    const fetcher = makeFetcher(html);
    await getIndexHistory(
      { exchange: "BRVM", period: "all", force_refresh: false },
      fetcher as never
    );
    expect(fetcher.fetchPage).toHaveBeenCalledWith("/bourse/brvm", undefined, false);
  });

  it("result.count matches dataPoints.length", async () => {
    const points = Array.from({ length: 7 }, (_, i) => ({
      date: dateOffset(i + 1),
      close: String(100 + i),
      volume: "0",
    }));
    const fetcher = makeFetcher(makeChartHtml(points));
    const result = await getIndexHistory(
      { exchange: "EGX", period: "1m", force_refresh: false },
      fetcher as never
    );
    expect(result.count).toBe(result.dataPoints.length);
    expect(result.count).toBe(7);
  });
});
