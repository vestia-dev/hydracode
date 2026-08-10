import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { openCodeExecutable, openCodeRuntimeTarget } from "./openCodeRuntime"

describe("OpenCode runtime", () => {
  it.each([
    ["darwin", "arm64", "@opencode-ai/cli-darwin-arm64", "opencode2"],
    ["darwin", "x64", "@opencode-ai/cli-darwin-x64-baseline", "opencode2"],
    ["linux", "arm64", "@opencode-ai/cli-linux-arm64", "opencode2"],
    ["linux", "x64", "@opencode-ai/cli-linux-x64-baseline", "opencode2"],
    ["win32", "arm64", "@opencode-ai/cli-windows-arm64", "opencode2.exe"],
    ["win32", "x64", "@opencode-ai/cli-windows-x64-baseline", "opencode2.exe"],
  ] as const)(
    "maps %s %s to its platform package",
    (platform, arch, packageName, executableName) => {
      expect(openCodeRuntimeTarget(platform, arch)).toEqual({ packageName, executableName })
    },
  )

  it("resolves the packaged executable from Electron resources", () => {
    expect(
      openCodeExecutable({
        platform: "darwin",
        arch: "arm64",
        isPackaged: true,
        resourcesPath: "/Applications/HydraCode.app/Contents/Resources",
        projectPath: "/source/hydracode",
      }),
    ).toBe(join("/Applications/HydraCode.app/Contents/Resources", "opencode", "opencode2"))
  })

  it("resolves the development executable from the installed optional package", () => {
    expect(
      openCodeExecutable({
        platform: "win32",
        arch: "x64",
        isPackaged: false,
        resourcesPath: "C:\\HydraCode\\resources",
        projectPath: "C:\\source\\hydracode",
      }),
    ).toBe(
      join(
        "C:\\source\\hydracode",
        "node_modules",
        "@opencode-ai/cli-windows-x64-baseline",
        "bin",
        "opencode2.exe",
      ),
    )
  })

  it("rejects unsupported targets", () => {
    expect(openCodeRuntimeTarget("freebsd", "x64")).toBeUndefined()
  })
})
