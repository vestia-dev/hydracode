export function directoryName(directory: string) {
  return (
    directory
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || directory
  )
}

export function projectDisplayName(name: string | undefined, directory: string) {
  const normalized = name?.trim()
  return normalized === undefined || normalized === "" ? directoryName(directory) : normalized
}

export function projectInitial(name: string) {
  return name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "?"
}
