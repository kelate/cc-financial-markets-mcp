/**
 * Tests unitaires pour le module auth (authentification Joomla)
 * Couvre : login, session, cookies, expiration
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { login, isAuthenticated, invalidateSession, cookieHeader } from "./auth.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Fixtures HTML ──────────────────────────────────────────────────────────

/** HTML minimal avec token CSRF valide (32 hex chars) et champ return */
const HTML_WITH_CSRF = `
<html><body>
<form>
  <input type="hidden" name="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4" value="1">
  <input name="return" value="aHR0cHM6Ly9leGFtcGxlLmNvbQ==">
</form>
</body></html>`;

/** HTML sans token CSRF (login impossible) */
const HTML_WITHOUT_CSRF = `<html><body><p>Page normale sans formulaire</p></body></html>`;

/** HTML de redirection contenant le lien de déconnexion */
const HTML_LOGGED_IN = `<html><body><a href="?task=user.logout">Déconnexion</a></body></html>`;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeResponse(
  body: string,
  status = 200,
  setCookies: string[] = [],
  locationHeader?: string
): Response {
  const headersMap: Record<string, string | null> = {
    location: locationHeader ?? null,
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(body),
    headers: {
      get: (key: string) => headersMap[key.toLowerCase()] ?? null,
      getSetCookie: vi.fn().mockReturnValue(setCookies),
    },
  } as unknown as Response;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateSession(); // réinitialise l'état de session entre chaque test
  });

  // ── login() ────────────────────────────────────────────────────────────

  describe("login()", () => {
    it("retourne false immédiatement sans credentials (username vide)", async () => {
      const result = await login("https://example.com/fr", "", "", "UA");

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("retourne true sans appeler fetch si la session est encore fraîche", async () => {
      // Première authentification
      mockFetch
        .mockResolvedValueOnce(makeResponse(HTML_WITH_CSRF, 200, ["PHPSESSID=abc; Path=/"]))
        .mockResolvedValueOnce(makeResponse("", 302, [], "/fr/"))
        .mockResolvedValueOnce(makeResponse(HTML_LOGGED_IN));
      await login("https://example.com/fr", "user", "pass", "UA");

      // Deuxième appel — session fraîche, ne doit pas refaire de requête
      vi.clearAllMocks();
      const result = await login("https://example.com/fr", "user", "pass", "UA");

      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("réussit via redirect GET + détection du lien Déconnexion", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(HTML_WITH_CSRF, 200, ["PHPSESSID=xyz; Path=/"]))
        .mockResolvedValueOnce(makeResponse("", 302, [], "/fr/"))
        .mockResolvedValueOnce(makeResponse(HTML_LOGGED_IN));

      const result = await login("https://example.com/fr", "user", "pass", "UA");

      expect(result).toBe(true);
      expect(isAuthenticated()).toBe(true);
    });

    it("réussit avec un code de réponse 303 (sans suivre le redirect)", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(HTML_WITH_CSRF))
        .mockResolvedValueOnce(makeResponse("", 303));

      const result = await login("https://example.com/fr", "user", "pass", "UA");

      expect(result).toBe(true);
    });

    it("retourne false quand le token CSRF est introuvable dans la page", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(HTML_WITHOUT_CSRF));

      const result = await login("https://example.com/fr", "user", "pass", "UA");

      expect(result).toBe(false);
      expect(isAuthenticated()).toBe(false);
    });

    it("retourne false en cas d'erreur réseau", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));

      const result = await login("https://example.com/fr", "user", "pass", "UA");

      expect(result).toBe(false);
    });

    it("POST le formulaire vers l'URL de login correcte", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(HTML_WITH_CSRF))
        .mockResolvedValueOnce(makeResponse("", 303));

      await login("https://example.com/fr", "myuser", "mypass", "UA");

      // Le 2ème appel est le POST de login
      const [, loginCall] = mockFetch.mock.calls;
      expect(loginCall[1].method).toBe("POST");
      expect(loginCall[1].body).toContain("username=myuser");
      expect(loginCall[1].body).toContain("password=mypass");
      expect(loginCall[1].body).toContain("option=com_users");
    });
  });

  // ── isAuthenticated() ──────────────────────────────────────────────────

  describe("isAuthenticated()", () => {
    it("retourne false initialement (pas de session)", () => {
      expect(isAuthenticated()).toBe(false);
    });

    it("retourne false après invalidateSession()", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(HTML_WITH_CSRF))
        .mockResolvedValueOnce(makeResponse("", 303));
      await login("https://example.com/fr", "user", "pass", "UA");

      invalidateSession();

      expect(isAuthenticated()).toBe(false);
    });

    it("retourne false quand la session a expiré (> 30 min)", async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(makeResponse(HTML_WITH_CSRF))
        .mockResolvedValueOnce(makeResponse("", 303));
      await login("https://example.com/fr", "user", "pass", "UA");
      expect(isAuthenticated()).toBe(true);

      // Avancer de 31 minutes (SESSION_MAX_AGE_MS = 30 min)
      vi.advanceTimersByTime(31 * 60 * 1000);

      expect(isAuthenticated()).toBe(false);
      vi.useRealTimers();
    });
  });

  // ── cookieHeader() ─────────────────────────────────────────────────────
  // Note : state.cookies est module-level et persiste entre les tests.
  // On teste uniquement le format après login — pas l'état vide initial.

  describe("cookieHeader()", () => {
    it("formate les cookies au format 'key=value; key=value' après login", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse(HTML_WITH_CSRF, 200, ["PHPSESSID=session123; Path=/", "csrf=token456; Path=/"])
        )
        .mockResolvedValueOnce(makeResponse("", 303));

      await login("https://example.com/fr", "user", "pass", "UA");
      const header = cookieHeader();

      expect(header).toContain("PHPSESSID=session123");
      expect(header).toContain("csrf=token456");
      // Vérifie le format général "key=value; key=value"
      expect(header).toMatch(/\w+=\w+/);
    });

    it("contient uniquement le nom et la valeur (sans Path, Secure, etc.)", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse(HTML_WITH_CSRF, 200, ["sessid=abc; Path=/; HttpOnly; Secure"])
        )
        .mockResolvedValueOnce(makeResponse("", 303));

      await login("https://example.com/fr", "user", "pass", "UA");
      const header = cookieHeader();

      expect(header).toContain("sessid=abc");
      expect(header).not.toContain("HttpOnly");
      expect(header).not.toContain("Secure");
    });
  });
});
