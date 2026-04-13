import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    reporters: process.env.CI ? ["verbose", "junit"] : ["verbose"],
    outputFile: { junit: "test-results/integration-tests.xml" },
    // Pas de threshold de coverage — les tests d'intégration
    // mesurent le comportement, pas la couverture de lignes
  },
});
