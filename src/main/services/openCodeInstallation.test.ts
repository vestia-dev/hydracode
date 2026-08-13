import { delimiter, join } from "node:path"
import { describe, expect, it } from "vitest"
import { openCodeExecutableCandidates } from "./openCodeInstallation"

describe("OpenCode installation", () => {
  it("checks the official install location before PATH", () => {
    expect(
      openCodeExecutableCandidates({
        platform: "darwin",
        home: "/Users/test",
        path: ["/usr/local/bin", "/opt/homebrew/bin"].join(delimiter),
      }),
    ).toEqual([
      join("/Users/test", ".opencode", "bin", "opencode2"),
      join("/Users/test", ".bun", "bin", "opencode2"),
      join("/usr/local/bin", "opencode2"),
      join("/opt/homebrew/bin", "opencode2"),
    ])
  })

  it("uses the Windows executable name", () => {
    expect(
      openCodeExecutableCandidates({ platform: "win32", home: "C:\\Users\\test" })[0],
    ).toContain("opencode2.exe")
  })
})
