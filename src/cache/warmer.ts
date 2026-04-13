/**
 * Proactive cache warmer for African market data.
 *
 * Strategy:
 *   - On server startup: immediately warm all exchanges
 *   - During trading hours (any market open): re-warm every TRADING_INTERVAL_MS
 *   - Outside trading hours (nights / weekends): re-warm every OFF_HOURS_INTERVAL_MS
 *
 * This ensures data is always pre-fetched and never served stale to MCP clients,
 * even when no tool call has been made recently.
 *
 * Rate impact: 17 exchanges × 2 pages (overview + listed-companies) = 34 req per cycle
 * + 1 homepage (news) = 35 req/cycle.  At 30 req/min limit → ~70 s to complete one cycle.
 * The warmer runs sequentially (not parallel) to stay within the shared rate limiter.
 */

import { logger } from "../logger.js";
import type { Fetcher } from "../scraper/fetcher.js";
import { AFRICAN_EXCHANGES } from "../types/markets.js";
import { getOpenExchanges, isAnyMarketOpen } from "../utils/market-hours.js";

/** Refresh interval during trading hours (any market open). Default: 5 minutes. */
const TRADING_INTERVAL_MS = 5 * 60 * 1000;

/** Refresh interval outside trading hours (nights, weekends). Default: 60 minutes. */
const OFF_HOURS_INTERVAL_MS = 60 * 60 * 1000;

export class CacheWarmer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cycling = false;
  private lastWarmAt: Date | null = null;
  private totalCycles = 0;

  constructor(private readonly fetcher: Fetcher) {}

  /** Start the background warming loop. Call once at server startup. */
  start(): void {
    logger.info("Cache warmer starting — initial warm on startup");
    void this.runCycle();
    // scheduleNext() is called at the end of runCycle()
  }

  /** Stop the warming loop (e.g. on graceful shutdown). */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      logger.info("Cache warmer stopped");
    }
  }

  /** Diagnostic info exposed via /health. */
  get stats() {
    return {
      lastWarmAt: this.lastWarmAt?.toISOString() ?? null,
      totalCycles: this.totalCycles,
      nextIntervalMs: isAnyMarketOpen() ? TRADING_INTERVAL_MS : OFF_HOURS_INTERVAL_MS,
    };
  }

  // ---------------------------------------------------------------------------

  private scheduleNext(): void {
    const intervalMs = isAnyMarketOpen() ? TRADING_INTERVAL_MS : OFF_HOURS_INTERVAL_MS;
    const openMarkets = getOpenExchanges();
    logger.debug("Cache warmer scheduled", {
      intervalMinutes: Math.round(intervalMs / 60_000),
      openMarkets: openMarkets.length > 0 ? openMarkets : "none",
    });
    this.timer = setTimeout(() => {
      void this.runCycle();
    }, intervalMs);
  }

  private async runCycle(): Promise<void> {
    if (this.cycling) {
      logger.debug("Cache warmer cycle already in progress, skipping");
      this.scheduleNext();
      return;
    }

    this.cycling = true;
    const openExchanges = new Set(getOpenExchanges());
    const allCodes = AFRICAN_EXCHANGES.map((e) => e.code);

    // Prioritise exchanges that are currently trading so their data is freshest first
    const ordered = [
      ...allCodes.filter((c) => openExchanges.has(c)),
      ...allCodes.filter((c) => !openExchanges.has(c)),
    ];

    logger.info("Cache warming cycle started", {
      cycle: this.totalCycles + 1,
      exchanges: ordered.length,
      openMarkets: openExchanges.size,
    });

    let warmed = 0;
    let errors = 0;

    for (const code of ordered) {
      const exchange = AFRICAN_EXCHANGES.find((e) => e.code === code)!;
      try {
        // Exchange overview page → movers + indices
        await this.fetcher.fetchPage(`/bourse/${exchange.url}`, undefined, true);
        // Listed companies → full stock table
        await this.fetcher.fetchPage(`/bourse/${exchange.url}/listed-companies`, undefined, true);
        warmed++;
      } catch (err) {
        errors++;
        logger.warn("Cache warming failed", { exchange: code, error: (err as Error).message });
      }
    }

    // Warm homepage for latest news
    try {
      await this.fetcher.fetchPage("", 600, true);
    } catch (err) {
      logger.warn("Cache warming failed for homepage news", { error: (err as Error).message });
    }

    this.lastWarmAt = new Date();
    this.totalCycles++;
    this.cycling = false;

    logger.info("Cache warming cycle complete", {
      cycle: this.totalCycles,
      warmed,
      errors,
      durationNote: "sequential fetch respects rate limiter",
    });

    this.scheduleNext();
  }
}
