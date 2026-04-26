/**
 * HTTP request logger — structured per-request logging with x-request-id tracing.
 * All output goes through the shared logger (stderr). Stdout stays clean for MCP JSON-RPC.
 */

import { randomBytes } from "node:crypto";
import { logger } from "./logger.js";

export function generateRequestId(): string {
  return "req-" + randomBytes(4).toString("hex");
}

export interface RequestLogParams {
  requestId: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  keyHint?: string;
}

export function logRequest(params: RequestLogParams): void {
  logger.info("http", { ...params });
}
