import { defineConfig } from "vitest/config";

// Unit tests for the frontend's pure logic (stats, formatting, scenario
// validation, store helpers). Node environment — no DOM needed; these cover the
// number-crunching that feeds the displayed figures, the half of the app the
// Python suite doesn't reach.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
