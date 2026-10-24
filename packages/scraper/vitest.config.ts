import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    maxWorkers: 2,
    name: "scraper",
    include: ["test/**/*.test.ts"],
  },
});
