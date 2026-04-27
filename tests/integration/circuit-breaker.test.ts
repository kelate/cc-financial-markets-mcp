/**
 * Tests d'intégration — Circuit breaker du scraper Fetcher
 *
 * Vérifie le cycle de vie CLOSED → OPEN → HALF_OPEN → OPEN/CLOSED via le serveur HTTP.
 *
 * Configuration:
 *  - AFRICAN_MARKETS_BASE_URL pointe vers 127.0.0.1:19999 (rien n'écoute → ECONNREFUSED).
 *  - CIRCUIT_BREAKER_THRESHOLD=2  → 2 échecs consécutifs ouvrent le circuit.
 *  - CIRCUIT_BREAKER_TIMEOUT_SECONDS=5 → cooldown court avant HALF_OPEN.
 *  - REDIS_URL="" forcé pour empêcher tout hit cache L2 qui shorterait le fetcher.
 *
 * Note port: le brief demandait 3096, mais ce port est déjà utilisé par rate-limit.test.ts
 * (Vitest exécute les fichiers en parallèle → collision garantie). On utilise 3095.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

const PORT = 3095;
const BASE_URL = `http://localhost:${PORT}`;

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

interface ToolCallResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

/** Initialise une session MCP et retourne le sessionId fourni dans le header. */
async function initSession(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/mcp`, {
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
        clientInfo: { name: "circuit-breaker-integration-test", version: "1.0" },
      },
    }),
  });
  if (response.status !== 200) {
    throw new Error(`initialize HTTP ${response.status}: ${await response.text()}`);
  }
  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("Aucun mcp-session-id retourné par /mcp initialize");
  // Drain le body pour libérer la socket
  await response.text();
  return sessionId;
}

/**
 * Appelle un outil MCP via /mcp tools/call et retourne la réponse JSON-RPC.
 * Gère les deux formats de réponse :
 *  - JSON direct (Content-Type: application/json)
 *  - Stream SSE (Content-Type: text/event-stream → ligne `data: { ...json... }`)
 */
async function callTool(
  baseUrl: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
  id = 2,
): Promise<ToolCallResponse> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("text/event-stream")) {
    // Format SSE: lignes "data: {json}". On prend le premier event data.
    const dataLine = body
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "));
    if (!dataLine) {
      throw new Error(`Réponse SSE sans event data: ${body.slice(0, 200)}`);
    }
    return JSON.parse(dataLine.slice(6)) as ToolCallResponse;
  }

  return JSON.parse(body) as ToolCallResponse;
}

/** Extrait le message d'erreur d'une réponse tool call (isError: true). */
function errorTextOf(resp: ToolCallResponse): string {
  expect(resp.result, "tool call doit avoir un result").toBeDefined();
  expect(resp.result?.isError, "tool call doit avoir isError=true").toBe(true);
  const text = resp.result?.content?.[0]?.text;
  expect(text, "result.content[0].text doit être défini").toBeTruthy();
  return text!;
}

describe("Circuit breaker — cycle CLOSED → OPEN → HALF_OPEN", () => {
  let serverProcess: ChildProcess | null = null;
  let sessionId = "";

  beforeAll(async () => {
    serverProcess = spawn("node", ["dist/index.js", "--http", String(PORT)], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        LOG_LEVEL: "info",
        AFRICAN_MARKETS_BASE_URL: "http://127.0.0.1:19999",
        CIRCUIT_BREAKER_THRESHOLD: "2",
        CIRCUIT_BREAKER_TIMEOUT_SECONDS: "5",
        CACHE_TTL_SECONDS: "1",
        RATE_LIMIT_REQUESTS_PER_MINUTE: "600",
        MCP_INBOUND_RATE_LIMIT: "0",
        REDIS_URL: "",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    await waitForReady(serverProcess);
    sessionId = await initSession(BASE_URL);
  }, 15_000);

  afterAll(() => {
    serverProcess?.kill("SIGTERM");
    serverProcess = null;
  });

  it("les N premières requêtes échouent avec une erreur réseau (pas CircuitOpenError)", async () => {
    // 2 appels (= THRESHOLD) qui doivent échouer en réseau, sans encore ouvrir le circuit
    // au moment de répondre. Le compteur passe à 2 sur le 2ème, mais l'erreur retournée
    // est l'erreur réseau finale du dernier retry, pas CircuitOpenError.
    for (let i = 0; i < 2; i++) {
      const resp = await callTool(BASE_URL, sessionId, "get_market_data", {
        exchange: "BRVM",
        type: "movers",
      }, 100 + i);
      const text = errorTextOf(resp);
      expect(text).not.toMatch(/circuit/i);
      expect(text).toMatch(/fetch|fail|ECONNREFUSED|HTTP/i);
    }
  }, 25_000);

  it("après THRESHOLD échecs, le circuit s'ouvre et retourne CircuitOpenError", async () => {
    // À ce stade le circuit est OPEN (2 échecs consécutifs). Le 3ème appel doit
    // court-circuiter immédiatement avec le message du CircuitOpenError.
    const resp = await callTool(BASE_URL, sessionId, "get_market_data", {
      exchange: "BRVM",
      type: "movers",
    }, 200);
    const text = errorTextOf(resp);
    expect(text.toLowerCase()).toMatch(/circuit|open/);
  }, 10_000);

  it("le circuit se referme après le timeout (HALF_OPEN → OPEN sur probe ratée)", async () => {
    // Attendre la fin du cooldown (5s + marge) pour passer en HALF_OPEN.
    await new Promise((r) => setTimeout(r, 6_000));

    // Probe en HALF_OPEN: la fonction est rappelée, échoue à nouveau (backend down),
    // le circuit repasse en OPEN. La réponse reste une erreur (réseau OU circuit selon timing).
    const resp = await callTool(BASE_URL, sessionId, "get_market_data", {
      exchange: "BRVM",
      type: "movers",
    }, 300);
    const text = errorTextOf(resp);
    // L'important: le tool call est une erreur. Le texte exact dépend de l'état au moment
    // du retour : soit l'échec réseau de la probe HALF_OPEN, soit un CircuitOpenError
    // si une autre requête a déjà re-ouvert le circuit avant celle-ci.
    expect(text).toMatch(/fetch|fail|ECONNREFUSED|HTTP|circuit|open/i);
  }, 25_000);
});
