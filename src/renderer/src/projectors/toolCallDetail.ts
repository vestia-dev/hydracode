const MAX_DETAIL_LENGTH = 280

function compactText(value: string) {
  const compacted = value.replaceAll(/\s+/g, " ").trim()
  return compacted.length <= MAX_DETAIL_LENGTH
    ? compacted
    : `${compacted.slice(0, MAX_DETAIL_LENGTH - 1)}…`
}

function stringField(input: Readonly<Record<string, unknown>>, key: string) {
  const value = input[key]
  return typeof value === "string" && value !== "" ? value : undefined
}

function fileName(path: string) {
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean)
  return segments.at(-1) ?? path
}

function fallbackDetail(input: string | Readonly<Record<string, unknown>>) {
  return compactText(typeof input === "string" ? input : JSON.stringify(input))
}

export function formatToolCallDetail(
  name: string,
  input: string | Readonly<Record<string, unknown>>,
) {
  if (typeof input === "string") return compactText(input)

  const normalizedName = name.toLowerCase().replaceAll(/[-_]/g, "")
  const path = stringField(input, "path") ?? stringField(input, "filePath")

  if (normalizedName === "subagent" || normalizedName === "task") {
    const detail =
      stringField(input, "description") ??
      stringField(input, "agent") ??
      stringField(input, "subagent_type")
    return detail === undefined ? fallbackDetail(input) : compactText(detail)
  }

  if (normalizedName === "grep" || normalizedName === "glob") {
    const pattern = stringField(input, "pattern")
    return pattern === undefined ? fallbackDetail(input) : compactText(pattern)
  }

  if (normalizedName === "shell" || normalizedName === "bash") {
    const command = stringField(input, "command")
    return command === undefined ? fallbackDetail(input) : compactText(command)
  }

  if (normalizedName === "webfetch") {
    const url = stringField(input, "url")
    return url === undefined ? fallbackDetail(input) : compactText(url)
  }

  if (normalizedName === "websearch") {
    const query = stringField(input, "query")
    return query === undefined ? fallbackDetail(input) : compactText(query)
  }

  if (normalizedName === "question") {
    const questions = input["questions"]
    const detail = Array.isArray(questions)
      ? questions
          .flatMap((question) =>
            typeof question === "object" && question !== null && "question" in question
              ? typeof question.question === "string"
                ? [question.question]
                : []
              : [],
          )
          .join(" · ")
      : ""
    return detail === "" ? fallbackDetail(input) : compactText(detail)
  }

  if (path !== undefined) return compactText(fileName(path))
  return fallbackDetail(input)
}
