import { describe, expect, it } from "vitest"
import { formatToolDiffDetail, projectToolDiff } from "./toolCallDiff"

describe("projectToolDiff", () => {
  it("projects legacy OpenCode apply_patch file metadata", () => {
    const diff = projectToolDiff("apply_patch", {
      files: [
        {
          filePath: "/code/src/app.ts",
          relativePath: "src/app.ts",
          type: "update",
          patch: "--- src/app.ts\n+++ src/app.ts\n@@ -1 +1 @@\n-old\n+new",
          additions: 1,
          deletions: 1,
        },
        {
          filePath: "/code/src/new.ts",
          relativePath: "src/new.ts",
          type: "add",
          patch: "--- /dev/null\n+++ src/new.ts\n@@ -0,0 +1 @@\n+new",
          additions: 1,
          deletions: 0,
        },
      ],
    })

    expect(diff?.files).toMatchObject([
      { path: "src/app.ts", status: "modified", additions: 1, deletions: 1 },
      { path: "src/new.ts", status: "added", additions: 1, deletions: 0 },
    ])
    expect(diff === undefined ? undefined : formatToolDiffDetail(diff)).toBe("2 files · +2 -1")
  })

  it("accepts newer file metadata and ignores malformed entries", () => {
    expect(
      projectToolDiff("apply-patch", {
        files: [
          { file: "old.ts", status: "deleted", patch: "patch", additions: 0, deletions: 3 },
          { file: "missing-patch.ts", additions: 1 },
        ],
      }),
    ).toEqual({
      files: [
        {
          path: "old.ts",
          status: "deleted",
          patch: "patch",
          additions: 0,
          deletions: 3,
        },
      ],
    })
  })

  it("does not project unrelated tools or metadata without valid files", () => {
    expect(projectToolDiff("edit", { files: [] })).toBeUndefined()
    expect(projectToolDiff("apply_patch", { files: "invalid" })).toBeUndefined()
    expect(projectToolDiff("apply_patch", { files: [{ file: "missing.ts" }] })).toBeUndefined()
  })
})
