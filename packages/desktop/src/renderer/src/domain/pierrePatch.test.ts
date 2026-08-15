import { describe, expect, it } from "vitest"
import { parsePierrePatch } from "./pierrePatch"

describe("parsePierrePatch", () => {
  it("adds file headers to short OpenCode patches", () => {
    const parsed = parsePierrePatch("src/app.ts", "@@ -1 +1,2 @@\n old\n+new")

    expect(parsed?.name).toBe("src/app.ts")
    expect(parsed?.hunks).toHaveLength(1)
    expect(parsed?.unifiedLineCount).toBeGreaterThan(0)
  })

  it("preserves complete unified patches", () => {
    const parsed = parsePierrePatch(
      "src/app.ts",
      "--- src/app.ts\n+++ src/app.ts\n@@ -1 +1 @@\n-old\n+new",
    )

    expect(parsed?.name).toBe("src/app.ts")
    expect(parsed?.hunks).toHaveLength(1)
  })

  it("rejects patches without renderable hunks", () => {
    expect(parsePierrePatch("src/app.ts", "*** Begin Patch")).toBeUndefined()
  })
})
