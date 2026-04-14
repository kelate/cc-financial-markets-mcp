/**
 * Tests unitaires pour Fetcher
 * Couvre : cache hit/miss, retries, authentification, expiration de session
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Cache } from "../cache/cache.js";
import { RateLimiter } from "./rate-limiter.js";

// Hoisted — mock du module auth avant l'import de Fetcher
vi.mock("./auth.js", () => ({
  login: vi.fn().mockResolvedValue(true),
  isAuthenticated: vi.fn().mockReturnValue(false),
  cookieHeader: vi.fn().mockReturnValue(""),
  invalidateSession: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { Fetcher } from "./fetcher.js";
import * as authMod from "./auth.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: vi.fn().mockResolvedValue(body),
    headers: {
      get: vi.fn().mockReturnValue(null),
      getSetCookie: vi.fn().mockReturnValue([]),
    },
  } as unknown as Response;
}

function makeFetcher(overrides: Partial<ConstructorParameters<typeof Fetcher>[0]> = {}) {
  return new Fetcher({
    baseUrl: "https://example.com",
    userAgent: "TestAgent/1.0",
    rateLimiter: new RateLimiter(600), // haute limite pour ne pas bloquer les tests
    cache: new Cache(60),
    auth: { username: "", password: "" },
    maxRetries: 3,
    ...overrides,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Fetcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authMod.isAuthenticated).mockReturnValue(false);
    vi.mocked(authMod.cookieHeader).mockReturnValue("");
  });

  // ── Cache ──────────────────────────────────────────────────────────────

  describe("cache", () => {
    it("retourne la valeur cachée sans appeler fetch", async () => {
      const cache = new Cache(60);
      cache.set("page:https://example.com/test", "<html>cached</html>");
      const fetcher = makeFetcher({ cache });

      const result = await fetcher.fetchPage("/test");

      expect(result).toBe("<html>cached</html>");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("stocke le résultat en cache après un fetch réussi", async () => {
      const cache = new Cache(60);
      mockFetch.mockResolvedValueOnce(makeResponse("<html>fresh</html>"));
      const fetcher = makeFetcher({ cache });

      const result = await fetcher.fetchPage("/page");

      expect(result).toBe("<html>fresh</html>");
      expect(cache.get<string>("page:https://example.com/page")).toBe("<html>fresh</html>");
    });

    it("respecte le TTL personnalisé passé à fetchPage", async () => {
      const cache = new Cache(60);
      const setSpy = vi.spyOn(cache, "set");
      mockFetch.mockResolvedValueOnce(makeResponse("<html>ok</html>"));
      const fetcher = makeFetcher({ cache });

      await fetcher.fetchPage("/doc", 3600);

      expect(setSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 3600);
    });
  });

  // ── Retries ────────────────────────────────────────────────────────────

  describe("retries", () => {
    /** Rend les setTimeout instantanés pour éviter de ralentir les tests */
    function mockInstantTimers() {
      vi.spyOn(global, "setTimeout").mockImplementation(
        (fn: Parameters<typeof setTimeout>[0]) => {
          (fn as () => void)();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
      );
    }

    it("réessaie et réussit après un premier échec réseau", async () => {
      mockInstantTimers();
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(makeResponse("<html>ok</html>"));
      const fetcher = makeFetcher({ maxRetries: 3 });

      const result = await fetcher.fetchPage("/retry");

      expect(result).toBe("<html>ok</html>");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("lève une erreur après avoir épuisé tous les retries", async () => {
      mockInstantTimers();
      mockFetch.mockRejectedValue(new Error("Always fails"));
      const fetcher = makeFetcher({ maxRetries: 3 });

      await expect(fetcher.fetchPage("/fail")).rejects.toThrow("Failed to fetch");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("lève une erreur sur un status HTTP non-ok (403)", async () => {
      mockInstantTimers();
      mockFetch.mockResolvedValue(makeResponse("Forbidden", 403));
      const fetcher = makeFetcher({ maxRetries: 2 });

      await expect(fetcher.fetchPage("/forbidden")).rejects.toThrow("HTTP 403");
    });
  });

  // ── Authentification ───────────────────────────────────────────────────

  describe("authentification", () => {
    it("appelle login() au premier fetch quand des credentials sont fournis", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse("<html>ok</html>"));
      const fetcher = makeFetcher({ auth: { username: "user", password: "pass" } });

      await fetcher.fetchPage("/protected");

      expect(authMod.login).toHaveBeenCalledWith(
        "https://example.com",
        "user",
        "pass",
        "TestAgent/1.0"
      );
    });

    it("ne rappelle pas login() sur les requêtes suivantes (authAttempted = true)", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse("<html>first</html>"))
        .mockResolvedValueOnce(makeResponse("<html>second</html>"));
      const fetcher = makeFetcher({ auth: { username: "user", password: "pass" } });

      await fetcher.fetchPage("/a");
      await fetcher.fetchPage("/b");

      expect(authMod.login).toHaveBeenCalledTimes(1);
    });

    it("n'appelle pas login() sans credentials (mode anonyme)", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse("<html>ok</html>"));
      const fetcher = makeFetcher({ auth: { username: "", password: "" } });

      await fetcher.fetchPage("/public");

      expect(authMod.login).not.toHaveBeenCalled();
    });

    it("inclut le header Cookie quand la session est authentifiée", async () => {
      vi.mocked(authMod.isAuthenticated).mockReturnValue(true);
      vi.mocked(authMod.cookieHeader).mockReturnValue("sess=abc123");
      mockFetch.mockResolvedValueOnce(makeResponse("<html>ok</html>"));
      const fetcher = makeFetcher();

      await fetcher.fetchPage("/auth");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Cookie: "sess=abc123" }),
        })
      );
    });

    it("ré-authentifie et réessaie quand la session a expiré (Abonnez-vous...)", async () => {
      vi.mocked(authMod.isAuthenticated).mockReturnValue(true);
      mockFetch
        .mockResolvedValueOnce(makeResponse("Abonnez-vous pour un accès illimité"))
        .mockResolvedValueOnce(makeResponse("<html>premium content</html>"));
      const fetcher = makeFetcher({ auth: { username: "user", password: "pass" } });

      const result = await fetcher.fetchPage("/premium");

      expect(authMod.invalidateSession).toHaveBeenCalled();
      expect(result).toBe("<html>premium content</html>");
    });
  });

  // ── URL absolues ───────────────────────────────────────────────────────

  describe("URL absolues", () => {
    it("utilise l'URL absolue telle quelle sans préfixer baseUrl", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse("<html>ok</html>"));
      const fetcher = makeFetcher();

      await fetcher.fetchPage("https://other.com/resource");

      expect(mockFetch).toHaveBeenCalledWith("https://other.com/resource", expect.any(Object));
    });
  });
});
