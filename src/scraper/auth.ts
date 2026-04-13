/**
 * Joomla authentication for african-markets.com.
 * Logs in via the com_users login form and maintains session cookies.
 */

import { logger } from "../logger.js";

interface AuthState {
  cookies: Map<string, string>;
  loggedIn: boolean;
  lastLogin: number;
}

const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

const state: AuthState = {
  cookies: new Map(),
  loggedIn: false,
  lastLogin: 0,
};

/**
 * Login to african-markets.com and store session cookies.
 * The Joomla login form requires:
 *   - A GET to obtain the CSRF token (hidden field with random name)
 *   - A POST with username, password, option=com_users, task=user.login, + CSRF token
 */
export async function login(baseUrl: string, username: string, password: string, userAgent: string): Promise<boolean> {
  if (!username || !password) {
    logger.warn("No credentials configured — running in anonymous mode (limited data)");
    return false;
  }

  // Check if session is still fresh
  if (state.loggedIn && Date.now() - state.lastLogin < SESSION_MAX_AGE_MS) {
    return true;
  }

  try {
    // Step 1: GET homepage to obtain CSRF token + session cookie
    logger.info("Authenticating to african-markets.com...");
    const homeResponse = await fetch(baseUrl, {
      headers: { "User-Agent": userAgent, Accept: "text/html", "Accept-Language": "fr-FR,fr;q=0.9" },
      redirect: "follow",
    });

    extractCookies(homeResponse);
    const homeHtml = await homeResponse.text();

    // Extract CSRF token — it's a hidden input with a 32-char hex name and value "1"
    const csrfMatch = homeHtml.match(/<input\s+type="hidden"\s+name="([a-f0-9]{32,})"\s+value="1"/);
    if (!csrfMatch) {
      logger.error("Could not find CSRF token on login page");
      return false;
    }
    const csrfToken = csrfMatch[1];

    // Extract the return value from the form
    const returnMatch = homeHtml.match(/name="return"\s+value="([^"]+)"/);
    const returnValue = returnMatch ? returnMatch[1] : Buffer.from(baseUrl).toString("base64");

    // Step 2: POST login form (all hidden fields required by Joomla)
    const formData = new URLSearchParams({
      username,
      password,
      remember: "on",
      option: "com_users",
      task: "user.login",
      return: returnValue,
      mod_id: "1642",
      [csrfToken]: "1",
    });

    const loginResponse = await fetch(baseUrl.replace(/\/fr$/, "/fr/"), {
      method: "POST",
      headers: {
        "User-Agent": userAgent,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9",
        Cookie: cookieHeader(),
        Referer: baseUrl,
        Origin: "https://www.african-markets.com",
      },
      redirect: "manual",
      body: formData.toString(),
    });

    extractCookies(loginResponse);

    // Follow redirect
    const location = loginResponse.headers.get("location");
    if (location) {
      const redirectUrl = location.startsWith("http") ? location : `${baseUrl.replace(/\/fr$/, "")}${location}`;
      const redirectResponse = await fetch(redirectUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html",
          Cookie: cookieHeader(),
        },
        redirect: "follow",
      });
      extractCookies(redirectResponse);
      const body = await redirectResponse.text();

      // Check if logged in — look for logout link or username in page
      if (body.includes("task=user.logout") || body.includes("Déconnexion")) {
        state.loggedIn = true;
        state.lastLogin = Date.now();
        logger.info("Authentication successful (premium access enabled)");
        return true;
      }
    }

    // Check 303 response for login success
    if (loginResponse.status === 303 || loginResponse.status === 302) {
      state.loggedIn = true;
      state.lastLogin = Date.now();
      logger.info("Authentication successful (redirect received)");
      return true;
    }

    logger.error("Authentication failed — check credentials");
    return false;
  } catch (error) {
    logger.error("Authentication error", { error: (error as Error).message });
    return false;
  }
}

/** Get the Cookie header string for authenticated requests */
export function cookieHeader(): string {
  return Array.from(state.cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/** Whether we have an active authenticated session */
export function isAuthenticated(): boolean {
  return state.loggedIn && Date.now() - state.lastLogin < SESSION_MAX_AGE_MS;
}

/** Force re-authentication on next request */
export function invalidateSession(): void {
  state.loggedIn = false;
  state.lastLogin = 0;
}

/** Extract Set-Cookie headers from a response into our cookie store */
function extractCookies(response: Response): void {
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) {
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      state.cookies.set(name, value);
    }
  }
}
