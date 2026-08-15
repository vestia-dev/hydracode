import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { OpenCode } from "@opencode-ai/client/effect"
import { Service as LocalOpenCodeService } from "@opencode-ai/client/effect/service"
import { Effect } from "effect"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, expect, it, vi } from "vitest"
import { OpenCodeService, OpenCodeServiceLive } from "./index"

afterEach(() => vi.restoreAllMocks())

it("starts the OpenCode V2 service", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hydracode-opencode-cli-"))
  const executable = join(directory, "opencode2")
  const previousPath = process.env["PATH"]
  await writeFile(executable, "#!/bin/sh\necho 2.1.0\n")
  await chmod(executable, 0o755)
  process.env["PATH"] = directory
  vi.spyOn(LocalOpenCodeService, "discover").mockReturnValue(Effect.succeed(undefined))
  const ensure = vi
    .spyOn(LocalOpenCodeService, "ensure")
    .mockReturnValue(Effect.succeed({ url: "http://127.0.0.1:4096" }))

  try {
    const connection = await Effect.runPromise(
      OpenCodeService.use((service) => service.connection).pipe(
        Effect.provide(OpenCodeServiceLive),
        Effect.provide(NodeFileSystem.layer),
      ),
    )

    expect(connection).toEqual({ url: "http://127.0.0.1:4096" })
    expect(ensure).toHaveBeenCalledWith({
      command: [expect.stringMatching(/opencode2$/), "serve", "--service"],
    })
  } finally {
    if (previousPath === undefined) delete process.env["PATH"]
    else process.env["PATH"] = previousPath
    await rm(directory, { recursive: true, force: true })
  }
})

it("finds the user-level V2 service when XDG state belongs to OpenCode Desktop", async () => {
  const defaultServiceFile = join(homedir(), ".local", "state", "opencode", "service.json")
  const endpoint = { url: "http://127.0.0.1:4096", auth: undefined }
  const discover = vi
    .spyOn(LocalOpenCodeService, "discover")
    .mockReturnValueOnce(Effect.succeed(undefined))
    .mockReturnValueOnce(Effect.succeed(endpoint))
  const ensure = vi.spyOn(LocalOpenCodeService, "ensure")

  const connection = await Effect.runPromise(
    OpenCodeService.use((service) => service.connection).pipe(
      Effect.provide(OpenCodeServiceLive),
      Effect.provide(NodeFileSystem.layer),
    ),
  )

  expect(connection).toEqual(endpoint)
  expect(discover).toHaveBeenNthCalledWith(1)
  expect(discover).toHaveBeenNthCalledWith(2, {
    file: defaultServiceFile,
  })
  expect(ensure).not.toHaveBeenCalled()
})

it("accepts a healthy service without enforcing its version", async () => {
  const endpoint = { url: "http://127.0.0.1:4096", auth: undefined }
  const discover = vi
    .spyOn(LocalOpenCodeService, "discover")
    .mockReturnValueOnce(Effect.succeed(endpoint))
  const ensure = vi.spyOn(LocalOpenCodeService, "ensure")

  const connection = await Effect.runPromise(
    OpenCodeService.use((service) => service.connection).pipe(
      Effect.provide(OpenCodeServiceLive),
      Effect.provide(NodeFileSystem.layer),
    ),
  )

  expect(connection).toEqual(endpoint)
  expect(discover).toHaveBeenCalledOnce()
  expect(ensure).not.toHaveBeenCalled()
})

it("accepts the current V2 prompt acknowledgement", async () => {
  const requests: Array<{ readonly url: string; readonly body: unknown }> = []
  const server = createServer((request, response) => {
    const chunks: Array<Buffer> = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      requests.push({
        url: request.url ?? "",
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      })
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          data: {
            id: "msg_test",
            sessionID: "ses_test",
            timeCreated: 1,
            type: "user",
            payload: { text: "Hello" },
            delivery: "steer",
          },
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("Test server did not start")
  vi.spyOn(LocalOpenCodeService, "discover").mockReturnValue(
    Effect.succeed({ url: `http://127.0.0.1:${address.port}`, auth: undefined }),
  )

  try {
    await Effect.runPromise(
      OpenCodeService.use((service) => service.submitPrompt("ses_test", "Hello")).pipe(
        Effect.provide(OpenCodeServiceLive),
        Effect.provide(NodeFileSystem.layer),
      ),
    )

    expect(requests).toEqual([{ url: "/api/session/ses_test/prompt", body: { text: "Hello" } }])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    )
  }
})

it("reports healthy service metadata without exposing credentials", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "hydracode-opencode-"))
  const registrationFile = join(stateDirectory, "opencode", "service.json")
  const previousStateHome = process.env["XDG_STATE_HOME"]
  process.env["XDG_STATE_HOME"] = stateDirectory
  await mkdir(join(stateDirectory, "opencode"), { recursive: true })
  await writeFile(
    registrationFile,
    JSON.stringify({
      id: "service-test",
      version: "0.0.0-next-17114",
      url: "http://127.0.0.1:4096",
      pid: 4242,
      password: "secret-value",
    }),
  )
  vi.spyOn(LocalOpenCodeService, "discover").mockImplementation((options) =>
    Effect.succeed(
      options?.file === registrationFile
        ? {
            url: "http://127.0.0.1:4096",
            auth: { type: "basic", username: "opencode", password: "secret-value" },
          }
        : undefined,
    ),
  )
  // The generated client has many unrelated resources; this test only exercises diagnostics.
  vi.spyOn(OpenCode, "make").mockReturnValue(
    // oxlint-disable-next-line no-unsafe-type-assertion
    Effect.succeed({
      health: {
        get: () => Effect.succeed({ healthy: true, version: "0.0.0-next-17114", pid: 4242 }),
      },
      server: {
        get: () => Effect.succeed({ urls: ["http://127.0.0.1:4096", "http://localhost:4096"] }),
      },
    } as never),
  )

  try {
    const diagnostics = await Effect.runPromise(
      OpenCodeService.use((service) => service.diagnostics).pipe(
        Effect.provide(OpenCodeServiceLive),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    const server = diagnostics.servers.find(
      (candidate) => candidate.registrationFile === registrationFile,
    )

    expect(diagnostics.status).toBe("healthy")
    expect(diagnostics.runningVersions).toEqual(["0.0.0-next-17114"])
    expect(server).toMatchObject({
      state: "healthy",
      authentication: "basic",
      instanceID: "service-test",
      registeredVersion: "0.0.0-next-17114",
      serverVersion: "0.0.0-next-17114",
      registeredPid: 4242,
      serverPid: 4242,
      advertisedUrls: ["http://127.0.0.1:4096", "http://localhost:4096"],
    })
    expect(JSON.stringify(diagnostics)).not.toContain("secret-value")
  } finally {
    if (previousStateHome === undefined) delete process.env["XDG_STATE_HOME"]
    else process.env["XDG_STATE_HOME"] = previousStateHome
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
