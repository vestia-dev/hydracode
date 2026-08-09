import { NodeFileSystem } from "@effect/platform-node"
import { Service as LocalOpenCodeService } from "@opencode-ai/client/effect/service"
import { Effect } from "effect"
import { homedir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { OpenCodeService, OpenCodeServiceLive } from "./OpenCodeService"

afterEach(() => vi.restoreAllMocks())

it("starts the OpenCode V2 service", async () => {
  vi.spyOn(LocalOpenCodeService, "discover").mockReturnValue(Effect.succeed(undefined))
  const ensure = vi
    .spyOn(LocalOpenCodeService, "ensure")
    .mockReturnValue(Effect.succeed({ url: "http://127.0.0.1:4096" }))

  const connection = await Effect.runPromise(
    OpenCodeService.use((service) => service.connection).pipe(
      Effect.provide(OpenCodeServiceLive),
      Effect.provide(NodeFileSystem.layer),
    ),
  )

  expect(connection).toEqual({ url: "http://127.0.0.1:4096" })
  expect(ensure).toHaveBeenCalledWith({ command: ["opencode2", "serve", "--service"] })
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
  expect(discover).toHaveBeenNthCalledWith(2, { file: defaultServiceFile })
  expect(ensure).not.toHaveBeenCalled()
})
