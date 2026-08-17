import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Effect } from "effect"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { SavedPromptsService, makeSavedPromptsServiceLive, savedPromptsPath } from "./index"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

function run<A>(dataDirectory: string, effect: Effect.Effect<A, unknown, SavedPromptsService>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(makeSavedPromptsServiceLive({ dataDirectory })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
}

it("persists trimmed prompts newest first", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "hydracode-saved-prompts-"))
  temporaryDirectories.push(dataDirectory)

  const prompts = await run(
    dataDirectory,
    SavedPromptsService.use((service) =>
      Effect.gen(function* () {
        yield* service.save(" first prompt ")
        yield* service.save("second prompt")
        return yield* service.list
      }),
    ),
  )

  expect(prompts.map(({ text }) => text)).toEqual(["second prompt", "first prompt"])
  const stored = JSON.parse(await readFile(savedPromptsPath({ dataDirectory }), "utf8"))
  expect(stored.prompts.map(({ text }: { text: string }) => text)).toEqual([
    "second prompt",
    "first prompt",
  ])
})

it("rejects empty prompts", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "hydracode-empty-prompt-"))
  temporaryDirectories.push(dataDirectory)

  await expect(
    run(
      dataDirectory,
      SavedPromptsService.use((service) => service.save("   ")),
    ),
  ).rejects.toMatchObject({ message: "Enter a prompt before saving." })
})
