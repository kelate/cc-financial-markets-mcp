/**
 * MCP tool: list_exchanges
 * Returns the list of all supported African stock exchanges.
 */

import { z } from "zod";
import { AFRICAN_EXCHANGES } from "../types/markets.js";

export const ListExchangesSchema = z.object({
  country: z
    .string()
    .optional()
    .describe("Filtrer par pays (recherche partielle, insensible à la casse)"),
});

export type ListExchangesInput = z.infer<typeof ListExchangesSchema>;

export function listExchanges(input: ListExchangesInput) {
  let exchanges = AFRICAN_EXCHANGES;

  if (input.country) {
    const search = input.country.toLowerCase();
    exchanges = exchanges.filter(
      (e) =>
        e.country.toLowerCase().includes(search) ||
        e.name.toLowerCase().includes(search)
    );
  }

  return {
    count: exchanges.length,
    exchanges: exchanges.map((e) => ({
      code: e.code,
      name: e.name,
      country: e.country,
      currency: e.currency,
    })),
  };
}
