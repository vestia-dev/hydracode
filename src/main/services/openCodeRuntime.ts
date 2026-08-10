import { join } from "node:path"

export const OPEN_CODE_RUNTIME_VERSION = "0.0.0-next-17028"

export interface OpenCodeRuntimeTarget {
  readonly packageName: string
  readonly executableName: string
}

const targets: Readonly<Record<string, OpenCodeRuntimeTarget>> = {
  "darwin-arm64": {
    packageName: "@opencode-ai/cli-darwin-arm64",
    executableName: "opencode2",
  },
  "darwin-x64": {
    packageName: "@opencode-ai/cli-darwin-x64-baseline",
    executableName: "opencode2",
  },
  "linux-arm64": {
    packageName: "@opencode-ai/cli-linux-arm64",
    executableName: "opencode2",
  },
  "linux-x64": {
    packageName: "@opencode-ai/cli-linux-x64-baseline",
    executableName: "opencode2",
  },
  "win32-arm64": {
    packageName: "@opencode-ai/cli-windows-arm64",
    executableName: "opencode2.exe",
  },
  "win32-x64": {
    packageName: "@opencode-ai/cli-windows-x64-baseline",
    executableName: "opencode2.exe",
  },
}

export function openCodeRuntimeTarget(
  platform: NodeJS.Platform,
  arch: string,
): OpenCodeRuntimeTarget | undefined {
  return targets[`${platform}-${arch}`]
}

export function openCodeExecutable(input: {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly isPackaged: boolean
  readonly resourcesPath: string
  readonly projectPath: string
}) {
  const target = openCodeRuntimeTarget(input.platform, input.arch)
  if (target === undefined) return undefined

  return input.isPackaged
    ? join(input.resourcesPath, "opencode", target.executableName)
    : join(input.projectPath, "node_modules", target.packageName, "bin", target.executableName)
}
