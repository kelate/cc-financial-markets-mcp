/**
 * HTTP fetcher with authentication, rate-limiting, retries, and cache integration.
 * Uses Node.js native fetch (available since Node 18+).
 */

import { Cache } from "../cache/cache.js";
import { logger } from "../logger.js";
import { cookieHeader, invalidateSession, isAuthenticated, login } from "./auth.js";
import { RateLimiter } from "./rate-limiter.js";

export interface FetcherOptions {
  baseUrl: string;
  userAgent: string;
  rateLimiter: RateLimiter;
  cache: Cache;
  auth: { username: string; password: string };
  maxRetries?: number;
}

export class Fetcher {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly rateLimiter: RateLimiter;
  private readonly cache: Cache;
  private readonly auth: { username: string; password: string };
  private readonly maxRetries: number;
  private authAttempted = false;

  constructor(options: FetcherOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.userAgent = options.userAgent;
    this.rateLimiter = options.rateLimiter;
    this.cache = options.cache;
    this.auth = options.auth;
    this.maxRetries = options.maxRetries ?? 3;
  }

  /** Ensure we're logged in before making requests. Called lazily on first fetch. */
  private async ensureAuth(): Promise<void> {
    if (this.authAttempted) return;
    this.authAttempted = true;

    if (this.auth.username && this.auth.password) {
      await login(this.baseUrl, this.auth.username, this.auth.password, this.userAgent);
    } else {
      logger.info("No credentials — running in anonymous mode");
    }
  }

  /**
   * Fetch a page as HTML string. Results are cached.
   * Authenticated requests include session cookies for premium content.
   * @param path - Relative path (e.g., "/bourse/brvm")
   * @param cacheTtl - Optional TTL override in seconds
   */
  async fetchPage(path: string, cacheTtl?: number): Promise<string> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const cacheKey = `page:${url}`;

    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      logger.debug("Cache hit", { url });
      return cached;
    }

    await this.ensureAuth();

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.rateLimiter.acquire();
        logger.debug("Fetching page", { url, attempt, authenticated: isAuthenticated() });

        const headers: Record<string, string> = {
          "User-Agent": this.userAgent,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "fr-FR,fr;q=0.9",
        };

        // Attach session cookies if authenticated
        if (isAuthenticated()) {
          headers.Cookie = cookieHeader();
        }

        const response = await fetch(url, { headers, redirect: "follow" });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();

        // Detect if session expired (page shows login prompt instead of content)
        if (isAuthenticated() && html.includes("Abonnez-vous pour un accès illimité") && this.auth.username) {
          logger.warn("Session expired — re-authenticating");
          invalidateSession();
          this.authAttempted = false;
          await this.ensureAuth();
          // Retry with fresh session
          continue;
        }

        this.cache.set(cacheKey, html, cacheTtl);
        logger.info("Page fetched", { url, size: html.length, premium: isAuthenticated() });
        return html;
      } catch (error) {
        lastError = error as Error;
        logger.warn("Fetch failed", { url, attempt, error: lastError.message });
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    throw new Error(`Failed to fetch ${url} after ${this.maxRetries} attempts: ${lastError?.message}`);
  }
}
