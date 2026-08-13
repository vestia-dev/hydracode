import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { formatToolCallDetail } from "./toolCallDetail"

it.effect("shows only the filename for path-based tools", () =>
  Effect.sync(() => {
    expect(
      formatToolCallDetail("read", { path: "/Users/matt/Documents/code/effect/index.ts" }),
    ).toBe("index.ts")
    expect(formatToolCallDetail("read", { filePath: String.raw`C:\code\effect\index.ts` })).toBe(
      "index.ts",
    )
    expect(formatToolCallDetail("edit", { filePath: "/code/effect/package.json" })).toBe(
      "package.json",
    )
  }),
)

it.effect("shows search patterns without their search paths", () =>
  Effect.sync(() => {
    expect(formatToolCallDetail("grep", { pattern: "Layer", path: "/code/effect" })).toBe("Layer")
    expect(formatToolCallDetail("glob", { pattern: "**/*.ts", path: "/code/effect" })).toBe(
      "**/*.ts",
    )
  }),
)

it.effect("keeps purpose-specific details for commands and web tools", () =>
  Effect.sync(() => {
    expect(formatToolCallDetail("shell", { command: "bun run test", description: "Test" })).toBe(
      "bun run test",
    )
    expect(
      formatToolCallDetail("webfetch", { url: "https://example.com/docs", format: "markdown" }),
    ).toBe("https://example.com/docs")
    expect(formatToolCallDetail("websearch", { query: "Effect Schema" })).toBe("Effect Schema")
  }),
)

it.effect("shows only the question text for question tools", () =>
  Effect.sync(() => {
    expect(
      formatToolCallDetail("question", {
        questions: [
          {
            header: "Season",
            question: "Which season would you choose?",
            options: [{ label: "Autumn", description: "Cool weather" }],
          },
        ],
      }),
    ).toBe("Which season would you choose?")
  }),
)

it.effect("falls back to compact structured input for unknown tools", () =>
  Effect.sync(() => {
    expect(formatToolCallDetail("custom-tool", { value: "hello" })).toBe('{"value":"hello"}')
  }),
)
