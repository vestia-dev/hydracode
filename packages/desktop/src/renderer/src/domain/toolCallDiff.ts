import type { GraphToolDiff, GraphToolDiffFile } from "./graph"

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(value: Readonly<Record<string, unknown>>, key: string) {
  const field = value[key]
  return typeof field === "string" && field !== "" ? field : undefined
}

function numberField(value: Readonly<Record<string, unknown>>, key: string) {
  const field = value[key]
  return typeof field === "number" && Number.isFinite(field) ? field : 0
}

function diffStatus(value: Readonly<Record<string, unknown>>): GraphToolDiffFile["status"] {
  const type = stringField(value, "type")
  if (type === "add") return "added"
  if (type === "delete") return "deleted"
  if (type === "move") return "moved"

  const status = stringField(value, "status")
  if (status === "added" || status === "deleted" || status === "modified") return status
  return "modified"
}

function diffFile(value: unknown): GraphToolDiffFile | undefined {
  if (!isRecord(value)) return undefined
  const path =
    stringField(value, "relativePath") ??
    stringField(value, "file") ??
    stringField(value, "filePath")
  const patch = stringField(value, "patch") ?? stringField(value, "diff")
  if (path === undefined || patch === undefined) return undefined

  return {
    path,
    status: diffStatus(value),
    patch,
    additions: numberField(value, "additions"),
    deletions: numberField(value, "deletions"),
  }
}

export function createToolDiff(
  name: string,
  metadata: Readonly<Record<string, unknown>> | undefined,
): GraphToolDiff | undefined {
  const normalizedName = name.toLowerCase().replaceAll(/[-_]/g, "")
  if (normalizedName !== "applypatch" && normalizedName !== "patch") return undefined
  const rawFiles = metadata?.["files"]
  if (!Array.isArray(rawFiles)) return undefined
  const files = rawFiles.flatMap((value) => {
    const file = diffFile(value)
    return file === undefined ? [] : [file]
  })
  return files.length === 0 ? undefined : { files }
}

export function formatToolDiffDetail(diff: GraphToolDiff) {
  const additions = diff.files.reduce((total, file) => total + file.additions, 0)
  const deletions = diff.files.reduce((total, file) => total + file.deletions, 0)
  const fileLabel = `${diff.files.length} ${diff.files.length === 1 ? "file" : "files"}`
  return `${fileLabel} · +${additions} -${deletions}`
}
