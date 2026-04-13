/**
 * GlobalSetup Vitest pour les tests d'intégration HTTP.
 * Démarre le serveur MCP en mode HTTP sur un port de test,
 * attend qu'il soit prêt, puis le coupe après les tests.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

export const TEST_PORT = 3099;
const SERVER_READY_SIGNAL = "MCP endpoint";
const STARTUP_TIMEOUT_MS = 10_000;

let serverProcess: ChildProcess | null = null;

/** Attend que le serveur soit prêt en lisant stderr */
function waitForReady(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Serveur non démarré après ${STARTUP_TIMEOUT_MS}ms`)),
      STARTUP_TIMEOUT_MS
    );

    proc.stderr?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes(SERVER_READY_SIGNAL)) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Serveur terminé avec le code ${code}`));
      }
    });
  });
}

export async function setup(): Promise<void> {
  serverProcess = spawn(
    "node",
    ["dist/index.js", "--http", String(TEST_PORT)],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        LOG_LEVEL: "info",
        CACHE_TTL_SECONDS: "5",
        RATE_LIMIT_REQUESTS_PER_MINUTE: "600",
      },
      stdio: ["ignore", "ignore", "pipe"],
    }
  );

  await waitForReady(serverProcess);
}

export async function teardown(): Promise<void> {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}
