import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Effect } from "effect"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { Schema } from "effect"
import { AbsolutePath, Location, Project } from "@opencode-ai/client/effect"
import {
  ApplicationStateService,
  applicationStatePath,
  makeApplicationStateServiceLive,
} from "./index"

const temporaryDirectories: string[] = []
const projectUIState = {
  locationKey: "/code/first\u0000",
  projectID: Schema.decodeUnknownSync(Project.ID)("first-project"),
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
  ).resolves.toEqual({ version: 2, openLocations: [], activeLocationKey: null, projects: [] })

  const projectID = Schema.decodeUnknownSync(Project.ID)("first-project")
  const location = Location.Ref.make({ directory: AbsolutePath.make("/code/first") })
  const saved = await run(
    dataDirectory,
    ApplicationStateService.use((service) =>
      service.saveSelection({
        openLocations: [
          { projectID, location },
          { projectID, location },
        ],
        activeLocationKey: "missing",
      }),
    ),
  )
  expect(saved).toEqual({
    version: 2,
    openLocations: [{ projectID, location }],
    activeLocationKey: "/code/first\u0000",
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
        yield* service.saveSelection({
          openLocations: [],
          activeLocationKey: null,
        })
        return yield* service.load
      }),
    ),
  )

  if (state.version !== 2) throw new Error("expected migrated v2 state")
  expect(state.projects).toEqual([projectUIState])
  expect(state.openLocations).toEqual([])
})
