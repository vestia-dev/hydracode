import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Project } from "@opencode-ai/client/effect"
import { Effect, Schema } from "effect"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { LayoutService, layoutPath, makeLayoutServiceLive } from "./LayoutService"
import type { SavedPaneLayout } from "../../shared/layout"

const temporaryDirectories: string[] = []
const projectID = Schema.decodeUnknownSync(Project.ID)("project-1")

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "hydracode-layout-"))
  temporaryDirectories.push(directory)
  return directory
}

function run<A>(configHome: string, effect: Effect.Effect<A, unknown, LayoutService>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(makeLayoutServiceLive({ configHome })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
}

const pane: SavedPaneLayout = {
  rootID: "pane-1",
  nodes: [{ _tag: "Pane" as const, id: "pane-1", sessionID: "session-1" }],
}

it("stores layouts by project and updates an existing saved layout", async () => {
  const configHome = await temporaryDirectory()
  const saved = await run(
    configHome,
    LayoutService.use((service) => service.save({ projectID, name: "First", layout: pane })),
  )
  const updated = await run(
    configHome,
    LayoutService.use((service) =>
      service.save({
        projectID,
        layoutID: saved.id,
        name: "Ignored replacement name",
        layout: {
          ...pane,
          nodes: [{ _tag: "Pane", id: "pane-1", sessionID: "session-2" }],
        },
      }),
    ),
  )

  expect(updated.id).toBe(saved.id)
  expect(updated.name).toBe("First")
  expect(updated.layout.nodes[0]).toMatchObject({ sessionID: "session-2" })
  await expect(
    run(
      configHome,
      LayoutService.use((service) => service.list(projectID)),
    ),
  ).resolves.toEqual([updated])
  expect(JSON.parse(await readFile(layoutPath({ configHome }), "utf8"))).toHaveLength(1)
})

it("deduplicates identical snapshots and keeps distinct layouts", async () => {
  const configHome = await temporaryDirectory()
  const first = await run(
    configHome,
    LayoutService.use((service) => service.save({ projectID, name: "First", layout: pane })),
  )
  const duplicate = await run(
    configHome,
    LayoutService.use((service) => service.save({ projectID, name: "Duplicate", layout: pane })),
  )
  await run(
    configHome,
    LayoutService.use((service) =>
      service.save({
        projectID,
        name: "Second",
        layout: {
          ...pane,
          nodes: [{ _tag: "Pane", id: "pane-1", sessionID: "session-2" }],
        },
      }),
    ),
  )
  const layouts = await run(
    configHome,
    LayoutService.use((service) => service.list(projectID)),
  )

  expect(duplicate.id).toBe(first.id)
  expect(layouts).toHaveLength(2)
  expect(layouts.map((layout) => layout.name)).toEqual(["Second", "First"])
})

it("rejects dangling and cyclic split references", async () => {
  const configHome = await temporaryDirectory()
  await expect(
    run(
      configHome,
      LayoutService.use((service) =>
        service.save({
          projectID,
          name: "Broken",
          layout: {
            rootID: "split",
            nodes: [
              {
                _tag: "Split",
                id: "split",
                direction: "horizontal",
                ratio: 0.5,
                first: "split",
                second: "missing",
              },
            ],
          },
        }),
      ),
    ),
  ).rejects.toMatchObject({ message: "HydraCode could not save an invalid pane layout." })
})

it("reports malformed persisted layout data instead of overwriting it", async () => {
  const configHome = await temporaryDirectory()
  const path = layoutPath({ configHome })
  await mkdir(join(configHome, "hydracode"))
  await writeFile(path, "not json")

  await expect(
    run(
      configHome,
      LayoutService.use((service) => service.list(projectID)),
    ),
  ).rejects.toMatchObject({ message: expect.stringContaining("could not load saved layouts") })
})
