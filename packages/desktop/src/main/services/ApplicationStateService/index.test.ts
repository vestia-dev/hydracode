import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Project } from "@opencode-ai/client/effect"
import { Effect, Schema } from "effect"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import {
  ApplicationStateService,
  applicationStatePath,
  makeApplicationStateServiceLive,
} from "./index"

const temporaryDirectories: string[] = []
const id = (value: string) => Schema.decodeUnknownSync(Project.ID)(value)
const projectUIState = {
  projectID: id("first"),
  activePaneID: "pane-1",
  layout: {
    rootID: "pane-1",
    nodes: [{ _tag: "Pane" as const, id: "pane-1" }],
  },
  panes: [],
  updated: 1,
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

function run<A>(dataDirectory: string, effect: Effect.Effect<A, unknown, ApplicationStateService>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(makeApplicationStateServiceLive({ dataDirectory })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
}

it("loads empty state and persists normalized project references", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "hydracode-application-state-"))
  temporaryDirectories.push(dataDirectory)
  await expect(
    run(
      dataDirectory,
      ApplicationStateService.use((service) => service.load),
    ),
  ).resolves.toEqual({ version: 1, openProjectIDs: [], activeProjectID: null, projects: [] })

  const saved = await run(
    dataDirectory,
    ApplicationStateService.use((service) =>
      service.saveSelection({
        openProjectIDs: [id("second"), id("first"), id("second")],
        activeProjectID: id("missing"),
      }),
    ),
  )
  expect(saved).toEqual({
    version: 1,
    openProjectIDs: ["second", "first"],
    activeProjectID: "second",
    projects: [],
  })
  expect(JSON.parse(await readFile(applicationStatePath({ dataDirectory }), "utf8"))).toEqual(saved)
})

it("keeps closed-project UI state when project selection changes", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "hydracode-application-state-project-ui-"))
  temporaryDirectories.push(dataDirectory)

  const state = await run(
    dataDirectory,
    ApplicationStateService.use((service) =>
      Effect.gen(function* () {
        yield* service.saveProjectUIState(projectUIState)
        yield* service.saveSelection({ openProjectIDs: [], activeProjectID: null })
        return yield* service.load
      }),
    ),
  )

  expect(state.projects).toEqual([projectUIState])
  expect(state.openProjectIDs).toEqual([])
})
