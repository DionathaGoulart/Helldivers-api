import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    maxWorkers: 2,
    name: "schemas",
    include: ["test/**/*.test.ts"],
  },
});
