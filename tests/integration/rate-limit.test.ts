/**
 * Tests d'intégration — Rate limiting inbound 429 sur /mcp.
 *
 * Vérifie le comportement de InboundRateLimiter câblé dans src/index.ts :
 *  - les N premières requêtes passent
 *  - la (N+1)ème renvoie 429 + Retry-After + erreur JSON-RPC -32029
 *  - OPTIONS preflight et GET HTML jamais rate-limités (court-circuités avant le check)
 *  - le compteur est segmenté par fingerprint de clé (Bearer 16 premiers chars vs "anonymous")
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

function waitForReady(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Serveur non démarré après 10s")),
      10_000
    );
    proc.stderr?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("MCP endpoint")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.on("error", (err) => { clearTimeout(timeout); reject(err); });
    proc.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Serveur terminé avec le code ${code}`));
      }
    });
  });
}

function initializePayload(id: number): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "rate-limit-integration-test", version: "1.0" },
    },
  });
}

// ─── Suite 1 : rate limit sans auth (clientKey = "anonymous") ─────────────────

describe("Rate limit /mcp — sans auth (anonymous bucket)", () => {
  const PORT = 3097;
  const BASE_URL = `http://localhost:${PORT}`;
  let serverProcess: ChildProcess | null = null;

  beforeAll(async () => {
    serverProcess = spawn("node", ["dist/index.js", "--http", String(PORT)], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        LOG_LEVEL: "info",
        CACHE_TTL_SECONDS: "5",
        RATE_LIMIT_REQUESTS_PER_MINUTE: "600",
        MCP_INBOUND_RATE_LIMIT: "3",
        // Pas de MCP_API_KEYS — auth désactivée pour isoler le test du rate limit
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    await waitForReady(serverProcess);
  });

  afterAll(() => {
    serverProcess?.kill("SIGTERM");
    serverProcess = null;
  });

  it("3 premières requêtes POST passent (pas de 429)", async () => {
    for (let i = 1; i <= 3; i++) {
      const response = await fetch(`${BASE_URL}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: initializePayload(i),
      });
      expect(response.status).not.toBe(429);
      // Drain le body pour libérer la socket avant l'itération suivante
      await response.text();
    }
  });

  it("4ème requête bloquée par 429 + Retry-After + erreur JSON-RPC -32029", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: initializePayload(99),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    const body = await response.json() as { jsonrpc: string; error: { code: number; message: string } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32029);
    expect(body.error.message).toMatch(/rate limit/i);
  });

  it("OPTIONS preflight jamais rate-limité (court-circuité avant le check)", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
  });

  it("GET /mcp (navigateur, Accept: text/html) jamais rate-limité", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      headers: { Accept: "text/html" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});

// ─── Suite 2 : compteurs séparés par fingerprint de clé ──────────────────────
//
// L'index.ts dérive la clé du rate limiter ainsi :
//   clientKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7, 23) : "anonymous"
// Ce qui donne 16 chars de fingerprint Bearer, vs literal "anonymous" sans Bearer.
//
// On reste SANS auth pour isoler le rate limiter de la couche auth (qui s'exécute
// avant lui dans index.ts:491). On vérifie ainsi que deux fingerprints distincts
// → deux compteurs indépendants : saturer "BearerKey" ne doit pas bloquer "anonymous".

describe("Rate limit /mcp — compteurs séparés par fingerprint", () => {
  const PORT = 3096;
  const BASE_URL = `http://localhost:${PORT}`;
  // 16+ chars pour que slice(7,23) retourne une vraie fingerprint distincte de "anonymous"
  const FAKE_BEARER = "abcdef0123456789xyz";
  let serverProcess: ChildProcess | null = null;

  beforeAll(async () => {
    serverProcess = spawn("node", ["dist/index.js", "--http", String(PORT)], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        LOG_LEVEL: "info",
        CACHE_TTL_SECONDS: "5",
        RATE_LIMIT_REQUESTS_PER_MINUTE: "600",
        MCP_INBOUND_RATE_LIMIT: "3",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    await waitForReady(serverProcess);
  });

  afterAll(() => {
    serverProcess?.kill("SIGTERM");
    serverProcess = null;
  });

  it("saturer le bucket Bearer ne bloque pas le bucket anonymous", async () => {
    // 1) Saturer le bucket Bearer (3 OK + 1 KO)
    for (let i = 1; i <= 3; i++) {
      const ok = await fetch(`${BASE_URL}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${FAKE_BEARER}`,
        },
        body: initializePayload(i),
      });
      expect(ok.status).not.toBe(429);
      await ok.text();
    }

    const blocked = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${FAKE_BEARER}`,
      },
      body: initializePayload(4),
    });
    expect(blocked.status).toBe(429);
    await blocked.text();

    // 2) Bucket anonymous toujours vierge → ne doit pas être 429
    const anonymous = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: initializePayload(5),
    });
    expect(anonymous.status).not.toBe(429);
    await anonymous.text();
  });
});
