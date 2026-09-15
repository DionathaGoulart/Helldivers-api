import { defineConfig } from "vitest/config";

// Vitest >= 3.2 replaced `vitest.workspace.ts` with `test.projects` (arch §11).
export default defineConfig({
  test: {
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
