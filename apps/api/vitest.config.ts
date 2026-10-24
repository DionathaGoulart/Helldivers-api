import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    maxWorkers: 2,
    name: "api",
    include: ["test/**/*.test.ts"],
  },
});
