import { describe, expect, it } from "vitest";
import { listExchanges } from "./list-exchanges.js";

describe("listExchanges", () => {
  it("returns all exchanges when no filter", () => {
    const result = listExchanges({});
    expect(result.count).toBeGreaterThan(10);
    expect(result.exchanges[0]).toHaveProperty("code");
    expect(result.exchanges[0]).toHaveProperty("name");
    expect(result.exchanges[0]).toHaveProperty("country");
    expect(result.exchanges[0]).toHaveProperty("currency");
  });

  it("filters by country name", () => {
    const result = listExchanges({ country: "Kenya" });
    expect(result.count).toBe(1);
    expect(result.exchanges[0].code).toBe("NSE");
  });

  it("filters case-insensitively", () => {
    const result = listExchanges({ country: "nigeria" });
    expect(result.count).toBe(1);
    expect(result.exchanges[0].code).toBe("NGX");
  });

  it("returns empty for non-matching filter", () => {
    const result = listExchanges({ country: "Antarctica" });
    expect(result.count).toBe(0);
    expect(result.exchanges).toEqual([]);
  });

  it("matches by exchange name too", () => {
    const result = listExchanges({ country: "BRVM" });
    expect(result.count).toBe(1);
    expect(result.exchanges[0].code).toBe("BRVM");
  });
});
