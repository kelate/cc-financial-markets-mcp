/**
 * African stock market trading hours in UTC.
 * Used by the cache warmer to determine refresh frequency:
 *   - During trading hours → refresh every ~5 min for near-real-time data
 *   - Outside trading hours → refresh every ~1 hour for daily freshness
 *
 * Sources:
 *   JSE  https://www.jse.co.za/trading/trading-hours
 *   EGX  https://www.egx.com.eg
 *   NSE  https://www.nse.co.ke
 *   NGX  https://ngxgroup.com
 *   BRVM https://www.brvm.org
 *   BVC  https://www.casablanca-bourse.com (Morocco, UTC+1 year-round since 2018)
 *   (others: exchange official sites)
 */

interface TradingSchedule {
  /** UTC hour (0–23) at open */
  openHour: number;
  /** UTC minute (0–59) at open */
  openMinute: number;
  /** UTC hour (0–23) at close */
  closeHour: number;
  /** UTC minute (0–59) at close */
  closeMinute: number;
}

/** Trading hours in UTC for each African exchange (Monday–Friday). */
const TRADING_HOURS: Record<string, TradingSchedule> = {
  // UTC+2 (SAST)  09:00–17:00 local → 07:00–15:00 UTC
  JSE:  { openHour: 7,  openMinute: 0,  closeHour: 15, closeMinute: 0  },
  // UTC+2 (CAT)   10:00–16:00 local → 08:00–14:00 UTC
  BSE:  { openHour: 8,  openMinute: 0,  closeHour: 14, closeMinute: 0  },
  // UTC+0 (GMT)   09:00–15:30 local → 09:00–15:30 UTC
  BRVM: { openHour: 9,  openMinute: 0,  closeHour: 15, closeMinute: 30 },
  // UTC+2 (EET)   10:00–14:30 local → 08:00–12:30 UTC
  EGX:  { openHour: 8,  openMinute: 0,  closeHour: 12, closeMinute: 30 },
  // UTC+0 (GMT)   09:30–14:30 local → 09:30–14:30 UTC
  GSE:  { openHour: 9,  openMinute: 30, closeHour: 14, closeMinute: 30 },
  // UTC+3 (EAT)   09:00–15:00 local → 06:00–12:00 UTC
  NSE:  { openHour: 6,  openMinute: 0,  closeHour: 12, closeMinute: 0  },
  // UTC+2 (CAT)   09:00–12:00 local → 07:00–10:00 UTC
  MSE:  { openHour: 7,  openMinute: 0,  closeHour: 10, closeMinute: 0  },
  // UTC+1 (CET)   09:30–15:30 local → 08:30–14:30 UTC
  BVC:  { openHour: 8,  openMinute: 30, closeHour: 14, closeMinute: 30 },
  // UTC+4 (MUT)   09:00–13:30 local → 05:00–09:30 UTC
  SEM:  { openHour: 5,  openMinute: 0,  closeHour: 9,  closeMinute: 30 },
  // UTC+1 (WAT)   09:00–17:00 local → 08:00–16:00 UTC
  NSX:  { openHour: 8,  openMinute: 0,  closeHour: 16, closeMinute: 0  },
  // UTC+1 (WAT)   10:00–14:30 local → 09:00–13:30 UTC
  NGX:  { openHour: 9,  openMinute: 0,  closeHour: 13, closeMinute: 30 },
  // UTC+3 (EAT)   09:00–17:00 local → 06:00–14:00 UTC
  USE:  { openHour: 6,  openMinute: 0,  closeHour: 14, closeMinute: 0  },
  // UTC+2 (CAT)   09:00–12:00 local → 07:00–10:00 UTC
  RSE:  { openHour: 7,  openMinute: 0,  closeHour: 10, closeMinute: 0  },
  // UTC+3 (EAT)   09:00–15:00 local → 06:00–12:00 UTC
  DSE:  { openHour: 6,  openMinute: 0,  closeHour: 12, closeMinute: 0  },
  // UTC+1 (CET)   09:00–15:00 local → 08:00–14:00 UTC
  BVMT: { openHour: 8,  openMinute: 0,  closeHour: 14, closeMinute: 0  },
  // UTC+2 (CAT)   10:00–12:30 local → 08:00–10:30 UTC
  LUSE: { openHour: 8,  openMinute: 0,  closeHour: 10, closeMinute: 30 },
  // UTC+2 (SAST)  09:00–13:30 local → 07:00–11:30 UTC
  ESE:  { openHour: 7,  openMinute: 0,  closeHour: 11, closeMinute: 30 },
  // UTC+2 (CAT)   10:00–16:00 local → 08:00–14:00 UTC
  ZSE:  { openHour: 8,  openMinute: 0,  closeHour: 14, closeMinute: 0  },
};

/** Returns true if the given exchange is currently within its trading session (UTC, Mon–Fri). */
export function isMarketOpen(exchangeCode: string): boolean {
  const schedule = TRADING_HOURS[exchangeCode.toUpperCase()];
  if (!schedule) return false;

  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sun, 6 = Sat

  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const openMinutes    = schedule.openHour  * 60 + schedule.openMinute;
  const closeMinutes   = schedule.closeHour * 60 + schedule.closeMinute;

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

/** Returns the list of exchange codes that are currently in session. */
export function getOpenExchanges(): string[] {
  return Object.keys(TRADING_HOURS).filter((code) => isMarketOpen(code));
}

/** Returns true if at least one African market is currently open. */
export function isAnyMarketOpen(): boolean {
  return getOpenExchanges().length > 0;
}
