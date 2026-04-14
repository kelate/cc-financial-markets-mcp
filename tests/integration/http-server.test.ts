/**
 * Tests d'intégration — Serveur HTTP MCP
 * Vérifie les endpoints /health, /mcp et la gestion des sessions.
 * Nécessite que le serveur soit déjà compilé (npm run build).
 */
import { describe, it, expect } from "vitest";
import { TEST_PORT } from "./setup.js";

const BASE_URL = `http://localhost:${TEST_PORT}`;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Initialise une session MCP et retourne le session-id */
async function initSession(): Promise<string> {
  const response = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "integration-test", version: "1.0" },
      },
    }),
  });

  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("Pas de mcp-session-id dans la réponse initialize");
  return sessionId;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Serveur HTTP — GET /health", () => {
  it("retourne 200 avec status=ok et les infos du serveur", async () => {
    const response = await fetch(`${BASE_URL}/health`);
    const body = await response.json() as Record<string, string>;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.server).toBe("cc-financial-markets-mcp");
    expect(body.version).toBeDefined();
  });
});

describe("Serveur HTTP — GET /mcp (navigateur)", () => {
  it("retourne une page HTML d'information pour les requêtes sans SSE accept", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      headers: { Accept: "text/html" },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("CC Financial Markets MCP");
    expect(body).toContain("list_exchanges");
    expect(body).toContain("/health");
  });
});

describe("Serveur HTTP — Protocole MCP (POST /mcp)", () => {
  it("initialise une nouvelle session et retourne un mcp-session-id", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();

    const text = await response.text();
    expect(text).toContain('"result"');
  });

  it("répond aux tools/list sur une session existante", async () => {
    const sessionId = await initSession();

    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("list_exchanges");
    expect(text).toContain("get_market_data");
  });

  it("retourne 404 pour un session-id inconnu", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": "session-inexistante-abc123",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }),
    });

    expect(response.status).toBe(404);
  });

  it("retourne 400 pour GET /mcp sans session-id (requête SSE invalide)", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      headers: { Accept: "text/event-stream" },
    });

    expect(response.status).toBe(400);
  });
});

describe("Serveur HTTP — Routes inconnues", () => {
  it("retourne 404 avec les endpoints valides dans la réponse", async () => {
    const response = await fetch(`${BASE_URL}/unknown-path`);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(404);
    expect(body.error).toBe("Not found");
    expect(body.endpoints).toBeDefined();
  });
});

describe("Serveur HTTP — CORS", () => {
  it("répond 204 aux requêtes OPTIONS preflight", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "OPTIONS",
    });

    expect(response.status).toBe(204);
  });

  it("inclut les headers CORS sur les réponses", async () => {
    const response = await fetch(`${BASE_URL}/health`);

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
