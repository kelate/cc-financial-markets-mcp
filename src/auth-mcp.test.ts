/**
 * Unit tests for auth-mcp module
 * Covers: resolveOrigin (CORS), isAuthorizedMcp (Bearer token)
 */
import { describe, it, expect } from "vitest";
import type { IncomingMessage } from "node:http";
import { resolveOrigin, isAuthorizedMcp } from "./auth-mcp.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReq(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("resolveOrigin", () => {
  it("returns '*' when allowedOrigins list is empty (backward compat)", () => {
    const req = makeReq({ origin: "https://example.com" });
    expect(resolveOrigin(req, [])).toBe("*");
  });

  it("returns the exact origin when it is in the allowed list", () => {
    const req = makeReq({ origin: "https://example.com" });
    expect(resolveOrigin(req, ["https://example.com", "https://other.com"])).toBe(
      "https://example.com"
    );
  });

  it("returns 'null' when the origin is not in the allowed list", () => {
    const req = makeReq({ origin: "https://evil.com" });
    expect(resolveOrigin(req, ["https://example.com"])).toBe("null");
  });

  it("returns 'null' when the request has no Origin header and list is non-empty", () => {
    const req = makeReq({});
    expect(resolveOrigin(req, ["https://example.com"])).toBe("null");
  });
});

describe("isAuthorizedMcp", () => {
  it("returns true when apiKeys list is empty (auth disabled)", () => {
    const req = makeReq({});
    expect(isAuthorizedMcp(req, [])).toBe(true);
  });

  it("returns false when Authorization header is absent", () => {
    const req = makeReq({});
    expect(isAuthorizedMcp(req, ["secret-key"])).toBe(false);
  });

  it("returns false when Authorization header has no Bearer prefix", () => {
    const req = makeReq({ authorization: "Basic dXNlcjpwYXNz" });
    expect(isAuthorizedMcp(req, ["secret-key"])).toBe(false);
  });

  it("returns true when the Bearer token matches a key in the list", () => {
    const req = makeReq({ authorization: "Bearer secret-key" });
    expect(isAuthorizedMcp(req, ["secret-key"])).toBe(true);
  });

  it("returns false when the Bearer token does not match any key", () => {
    const req = makeReq({ authorization: "Bearer wrong-token" });
    expect(isAuthorizedMcp(req, ["secret-key"])).toBe(false);
  });

  it("returns false when the token length differs from all keys (no crypto error)", () => {
    const req = makeReq({ authorization: "Bearer short" });
    expect(isAuthorizedMcp(req, ["much-longer-key-than-token"])).toBe(false);
  });

  it("returns true when the token matches the second key in the list", () => {
    const req = makeReq({ authorization: "Bearer second-key" });
    expect(isAuthorizedMcp(req, ["first-key", "second-key"])).toBe(true);
  });
});
