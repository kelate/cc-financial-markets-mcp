/**
 * Parser for the inline `chartData` JS variable embedded in african-markets.com exchange pages.
 * The variable contains ~2700 daily data points since 2015.
 */

export interface IndexDataPoint {
  date: string;  // "YYYY-MM-DD"
  close: number;
  volume: number;
}

/**
 * Extracts and parses the `chartData` array from the raw HTML of an exchange page.
 * Returns data points sorted by date ascending.
 * Returns an empty array if no valid data is found.
 */
export function parseIndexHistory(html: string): IndexDataPoint[] {
  const match = html.match(/var\s+chartData\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    return [];
  }

  let raw: Array<{ date?: unknown; close?: unknown; volume?: unknown }>;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return [];
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  const points: IndexDataPoint[] = raw
    .filter((item) => {
      if (!item || typeof item !== "object") return false;
      const close = parseFloat(String(item.close ?? "0"));
      return isFinite(close) && close > 0;
    })
    .map((item) => ({
      date: String(item.date ?? ""),
      close: parseFloat(String(item.close)),
      volume: parseInt(String(item.volume ?? "0"), 10) || 0,
    }));

  points.sort((a, b) => a.date.localeCompare(b.date));

  return points;
}
