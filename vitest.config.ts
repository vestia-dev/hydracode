import { defineConfig } from "vitest/config"

export default defineConfig({
  ssr: {
    noExternal: ["@opencode-ai/client", "@opencode-ai/protocol", "@opencode-ai/schema"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
