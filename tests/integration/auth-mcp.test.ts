/**
 * Tests d'intégration — Auth Bearer sur /mcp
 * Démarre un serveur avec MCP_API_KEYS et vérifie les flux 401/200.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const AUTH_TEST_PORT = 3098;
const TEST_KEY = "s0-integration-test-key-abc123";
const BASE_URL = `http://localhost:${AUTH_TEST_PORT}`;

let serverProcess: ChildProcess | null = null;

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

describe("Auth Bearer — /mcp avec MCP_API_KEYS", () => {
  beforeAll(async () => {
    serverProcess = spawn("node", ["dist/index.js", "--http", String(AUTH_TEST_PORT)], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        LOG_LEVEL: "info",
        CACHE_TTL_SECONDS: "5",
        RATE_LIMIT_REQUESTS_PER_MINUTE: "600",
        MCP_API_KEYS: TEST_KEY,
        MCP_ALLOWED_ORIGINS: "https://test.example.com",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    await waitForReady(serverProcess);
  });

  afterAll(() => {
    serverProcess?.kill("SIGTERM");
    serverProcess = null;
  });

  it("POST /mcp sans Authorization → 401 + WWW-Authenticate", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    const body = await response.json() as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toMatch(/unauthorized/i);
  });

  it("POST /mcp avec token invalide → 401", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer mauvais-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
  });

  it("GET /mcp (navigateur) → 200 public même avec auth activée", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      headers: { Accept: "text/html" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("CC Financial Markets MCP");
  });

  it("POST /mcp avec token valide → 200 + mcp-session-id", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${TEST_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "auth-integration-test", version: "1.0" },
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();
  });

  it("CORS — origin autorisée → reflétée dans Access-Control-Allow-Origin", async () => {
    const response = await fetch(`${BASE_URL}/health`, {
      headers: { Origin: "https://test.example.com" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.example.com");
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("CORS — origin non autorisée → null", async () => {
    const response = await fetch(`${BASE_URL}/health`, {
      headers: { Origin: "https://attaquant.com" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("null");
  });

  it("OPTIONS preflight → 204 sans vérification d'auth", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
  });
});
