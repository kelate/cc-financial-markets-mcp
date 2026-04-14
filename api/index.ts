/**
 * Vercel serverless entry point.
 * Re-exports the HTTP handler from src/index.ts.
 * Vercel compiles this TypeScript natively — no dist/ dependency needed.
 */
export { default } from "../src/index.js";
