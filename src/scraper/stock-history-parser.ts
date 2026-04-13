/**
 * Parser for stock price history data on african-markets.com company pages.
 *
 * The historical chart data is premium content — it is only present in the HTML
 * when the user has an authenticated session. Without credentials the page renders
 * a paywall block instead of the chart.
 *
 * When authenticated, the site embeds the OHLCV series as a JavaScript variable:
 *   var chartData = [{date:"YYYY-MM-DD", open:N, high:N, low:N, close:N, volume:N}, …];
 *
 * Paywall detection strings (either language may appear):
 *   - "Abonnez-vous pour un accès illimité"  (French)
 *   - "btn-singup"  (English CTA button class)
 */

export interface StockDataPoint {
  date: string; // "YYYY-MM-DD"
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

/**
 * Parse stock price history from a company page HTML string.
 *
 * Returns an empty array when:
 *   - The paywall is detected (unauthenticated access)
 *   - The chartData variable is absent or empty
 *   - No valid data points (close > 0) are found
 *
 * On success returns data points sorted ascending by date.
 */
export function parseStockHistory(html: string): StockDataPoint[] {
  // Paywall detection — both French and English versions
  if (
    html.includes("Abonnez-vous pour un accès illimité") ||
    html.includes("btn-singup")
  ) {
    return [];
  }

  // Try to extract the chartData JS variable.
  // The site embeds it as:  var chartData = [ {…}, … ];
  const match = html.match(/var\s+chartData\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    return [];
  }

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return [];
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const points: StockDataPoint[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;

    const entry = item as Record<string, unknown>;

    // Normalise the date field — may be "YYYY-MM-DD" or "DD/MM/YYYY"
    const rawDate =
      typeof entry.date === "string"
        ? entry.date.trim()
        : typeof entry.Date === "string"
          ? (entry.Date as string).trim()
          : "";

    const date = normaliseDate(rawDate);
    if (!date) continue;

    const close = toNumber(entry.close ?? entry.Close);
    if (!close || close <= 0) continue;

    const point: StockDataPoint = { date, close };

    const open = toNumber(entry.open ?? entry.Open);
    if (open && open > 0) point.open = open;

    const high = toNumber(entry.high ?? entry.High);
    if (high && high > 0) point.high = high;

    const low = toNumber(entry.low ?? entry.Low);
    if (low && low > 0) point.low = low;

    const volume = toNumber(entry.volume ?? entry.Volume);
    if (volume !== undefined && volume >= 0) point.volume = volume;

    points.push(point);
  }

  // Sort ascending by date
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return points;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a value to a finite number, or undefined on failure. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string") {
    // Handle French number format: "1 234,56" → 1234.56
    const cleaned = value.replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    if (isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Normalise a date string to "YYYY-MM-DD".
 * Accepts "YYYY-MM-DD" (ISO) and "DD/MM/YYYY" (French site format).
 */
function normaliseDate(raw: string): string | null {
  if (!raw) return null;

  // ISO format already
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // French format DD/MM/YYYY
  const fr = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;

  return null;
}
