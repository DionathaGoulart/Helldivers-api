import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "schemas",
    include: ["test/**/*.test.ts"],
  },
});
