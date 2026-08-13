import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"

const PATCH_HAS_FILE_HEADER = /^(?:diff --git |Index: |---\s+\S)/mu

export function parsePierrePatch(path: string, patch: string): FileDiffMetadata | undefined {
  const input = PATCH_HAS_FILE_HEADER.test(patch)
    ? patch
    : `Index: ${path}\n===================================================================\n--- ${path}\t\n+++ ${path}\t\n${patch}`

  try {
    const file = parsePatchFiles(input)[0]?.files[0]
    return file !== undefined && file.hunks.length > 0 ? file : undefined
  } catch {
    return undefined
  }
}
