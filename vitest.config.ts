import { defineConfig } from "vitest/config";

// Vitest >= 3.2 replaced `vitest.workspace.ts` with `test.projects` (arch §11).
export default defineConfig({
  test: {
    // Dataset integration tests parse hundreds of HTML pages and copy full snapshots.
    // Bound concurrency to avoid CPU/memory contention and spurious timeouts on CI/dev hosts.
    maxWorkers: 2,
    projects: [
      "packages/*",
      "apps/api",
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.ts"],
        },
      },
    ],
  },
});
