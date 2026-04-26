import { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";

export function resolveOrigin(req: IncomingMessage, allowedOrigins: string[]): string {
  if (allowedOrigins.length === 0) return "*";
  const origin = req.headers["origin"] ?? "";
  return allowedOrigins.includes(origin) ? origin : "null";
}

export function isAuthorizedMcp(req: IncomingMessage, apiKeys: string[]): boolean {
  if (apiKeys.length === 0) return true;
  const authHeader = req.headers["authorization"] ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const tokenBuf = Buffer.from(token);
  return apiKeys.some((key) => {
    const keyBuf = Buffer.from(key);
    if (keyBuf.length !== tokenBuf.length) return false;
    return timingSafeEqual(keyBuf, tokenBuf);
  });
}
