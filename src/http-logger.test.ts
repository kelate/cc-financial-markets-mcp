import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateRequestId, logRequest } from "./http-logger.js";
import { logger } from "./logger.js";

describe("generateRequestId", () => {
  it("retourne une chaîne au format req- suivi de 8 caractères hexadécimaux", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req-[0-9a-f]{8}$/);
  });

  it("génère des identifiants uniques entre deux appels successifs", () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
  });

  it("génère des identifiants uniques sur un grand nombre d'appels", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });
});

describe("logRequest", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appelle logger.info avec le message 'http' et les paramètres fournis", () => {
    const params = {
      requestId: "req-abcd1234",
      method: "GET",
      path: "/health",
      status: 200,
      latencyMs: 42,
    };

    logRequest(params);

    expect(infoSpy).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledWith("http", params);
  });

  it("transmet le keyHint quand il est fourni", () => {
    const params = {
      requestId: "req-deadbeef",
      method: "POST",
      path: "/mcp",
      status: 200,
      latencyMs: 123,
      keyHint: "sk-abc123",
    };

    logRequest(params);

    expect(infoSpy).toHaveBeenCalledWith("http", params);
    const callArgs = infoSpy.mock.calls[0];
    expect((callArgs[1] as typeof params).keyHint).toBe("sk-abc123");
  });

  it("fonctionne sans keyHint (champ optionnel)", () => {
    const params = {
      requestId: "req-00000001",
      method: "OPTIONS",
      path: "/mcp",
      status: 204,
      latencyMs: 1,
    };

    logRequest(params);

    expect(infoSpy).toHaveBeenCalledOnce();
    const callArgs = infoSpy.mock.calls[0];
    expect((callArgs[1] as typeof params & { keyHint?: string }).keyHint).toBeUndefined();
  });
});
