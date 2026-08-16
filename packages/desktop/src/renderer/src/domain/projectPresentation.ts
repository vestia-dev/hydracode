export function directoryName(directory: string) {
  return (
    directory
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || directory
  )
}

export function projectDisplayName(
  name: string | undefined,
  directory: string,
  projectID?: Project.ID,
) {
  if (projectID === Project.ID.global) return "Global"
  const normalized = name?.trim()
  return normalized === undefined || normalized === "" ? directoryName(directory) : normalized
}

export function projectInitial(name: string) {
  return name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "?"
}
import { Project } from "@opencode-ai/client/effect"
