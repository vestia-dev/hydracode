import { Effect, Schema } from "effect"
import { execFile, spawn } from "node:child_process"
import { access } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { promisify } from "node:util"

const execFilePromise = promisify(execFile)

export const OPEN_CODE_INSTALL_URL =
  "https://raw.githubusercontent.com/anomalyco/opencode/v2/install"

export interface OpenCodeInstallation {
  readonly executable: string
  readonly version: string
}

export class OpenCodeInstallationError extends Schema.TaggedErrorClass<OpenCodeInstallationError>()(
  "OpenCodeInstallationError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

export function openCodeExecutableCandidates(input: {
  readonly platform: NodeJS.Platform
  readonly home: string
  readonly path?: string
}) {
  const executable = input.platform === "win32" ? "opencode2.exe" : "opencode2"
  const paths = [
    join(input.home, ".opencode", "bin", executable),
    join(input.home, ".bun", "bin", executable),
  ]
  for (const directory of input.path?.split(delimiter) ?? []) {
    if (directory !== "") paths.push(join(directory, executable))
  }
  if (input.platform !== "win32") {
    paths.push(join("/opt/homebrew/bin", executable), join("/usr/local/bin", executable))
  }
  return [...new Set(paths)]
}

export const findOpenCodeInstallation = Effect.gen(function* () {
  const candidates = openCodeExecutableCandidates({
    platform: process.platform,
    home: homedir(),
    ...(process.env["PATH"] === undefined ? {} : { path: process.env["PATH"] }),
  })
  for (const executable of candidates) {
    const available = yield* Effect.tryPromise(() => access(executable)).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    if (!available) continue
    const result = yield* Effect.tryPromise(() => execFilePromise(executable, ["--version"])).pipe(
      Effect.option,
    )
    if (result._tag === "None") continue
    const version = result.value.stdout.trim().split(/\s+/).at(-1)?.replace(/^v/, "")
    if (version !== undefined && version !== "") return { executable, version }
  }
  return undefined
})

export const installOpenCode = Effect.gen(function* () {
  if (process.platform === "win32")
    return yield* new OpenCodeInstallationError({
      message: "Install OpenCode from WSL using the official OpenCode V2 instructions.",
      cause: { platform: process.platform },
    })

  const response = yield* Effect.tryPromise({
    try: () => fetch(OPEN_CODE_INSTALL_URL),
    catch: (cause) =>
      new OpenCodeInstallationError({
        message: "HydraCode could not download the official OpenCode installer.",
        cause,
      }),
  })
  if (!response.ok)
    return yield* new OpenCodeInstallationError({
      message: `The OpenCode installer request failed with HTTP ${response.status}.`,
      cause: { status: response.status },
    })
  const script = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) =>
      new OpenCodeInstallationError({
        message: "HydraCode could not read the official OpenCode installer.",
        cause,
      }),
  })
  yield* Effect.callback<void, OpenCodeInstallationError>((resume) => {
    const child = spawn("/bin/bash", ["-s", "--"], {
      env: process.env,
      stdio: ["pipe", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (value: string) => {
      stderr += value
    })
    child.once("error", (cause) =>
      resume(
        Effect.fail(
          new OpenCodeInstallationError({
            message: "HydraCode could not start the OpenCode installer.",
            cause,
          }),
        ),
      ),
    )
    child.once("close", (code) =>
      resume(
        code === 0
          ? Effect.void
          : Effect.fail(
              new OpenCodeInstallationError({
                message:
                  stderr.trim() || `The OpenCode installer exited with status ${String(code)}.`,
                cause: { code },
              }),
            ),
      ),
    )
    child.stdin.end(script)
    return Effect.sync(() => child.kill())
  })
  const installed = yield* findOpenCodeInstallation
  if (installed === undefined)
    return yield* new OpenCodeInstallationError({
      message: "OpenCode installed, but HydraCode could not find the opencode2 executable.",
      cause: { installDirectory: join(homedir(), ".opencode", "bin") },
    })
  return installed
})
