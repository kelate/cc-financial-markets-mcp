/**
 * Server configuration loaded from environment variables with sensible defaults.
 */

export interface Config {
  baseUrl: string;
  httpPort: number;
  cacheTtlSeconds: number;
  cacheTtlReportsSeconds: number;
  cacheTtlProfilesSeconds: number;
  rateLimitPerMinute: number;
  logLevel: "debug" | "info" | "warn" | "error";
  userAgent: string;
  auth: {
    username: string;
    password: string;
  };
  /** Enable background cache warmer (proactive pre-fetch). Disable in serverless environments. */
  cacheWarmingEnabled: boolean;
  redis: {
    url: string;
    enabled: boolean;
  };
  /** Secret for manual /admin/warm calls. Cron requests are authenticated via x-vercel-cron header. */
  adminSecret: string;
  /** API keys for /mcp Bearer auth. Empty = auth disabled (stdio/dev mode). */
  mcpApiKeys: string[];
  /** Allowed origins for CORS Access-Control-Allow-Origin. Empty = wildcard "*". */
  allowedOrigins: string[];
  /** Max requests per minute per API key on /mcp. 0 = disabled. */
  mcpInboundRateLimitPerMinute: number;
  /** Circuit breaker (resilience) for the scraper fetcher. */
  circuitBreaker: {
    failureThreshold: number;
    timeoutSeconds: number;
  };
}

export function loadConfig(): Config {
  const redisUrl = process.env.REDIS_URL || "";
  return {
    baseUrl: process.env.AFRICAN_MARKETS_BASE_URL || "https://www.african-markets.com/fr",
    httpPort: parseInt(process.env.HTTP_PORT || "3100", 10),
    cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || "300", 10),
    cacheTtlReportsSeconds: parseInt(process.env.CACHE_TTL_REPORTS_SECONDS || "3600", 10),
    cacheTtlProfilesSeconds: parseInt(process.env.CACHE_TTL_PROFILES_SECONDS || "1800", 10),
    rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || "30", 10),
    logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) || "info",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) AfricanMarketsMCP/0.1.0",
    auth: {
      username: process.env.AFRICAN_MARKETS_USERNAME || "",
      password: process.env.AFRICAN_MARKETS_PASSWORD || "",
    },
    cacheWarmingEnabled: process.env.CACHE_WARMING_ENABLED !== "false",
    redis: {
      url: redisUrl,
      enabled: !!redisUrl,
    },
    adminSecret: process.env.MCP_ADMIN_SECRET || "",
    mcpApiKeys: (process.env.MCP_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean),
    allowedOrigins: (process.env.MCP_ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean),
    mcpInboundRateLimitPerMinute: parseInt(process.env.MCP_INBOUND_RATE_LIMIT || "60", 10),
    circuitBreaker: {
      failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || "3", 10),
      timeoutSeconds: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT_SECONDS || "30", 10),
    },
  };
}
