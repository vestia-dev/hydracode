import { AbsolutePath, Location, Project } from "@opencode-ai/client/effect"
import { Schema } from "effect"
import { expect, it } from "vitest"
import { restoreApplicationState } from "./applicationState"

const id = (value: string) => Schema.decodeUnknownSync(Project.ID)(value)
const projects = ["third", "first", "second"].map((value) => ({
  project: { id: id(value), canonical: `/${value}` },
  locations: [
    {
      ref: Location.Ref.make({ directory: AbsolutePath.make(`/${value}`) }),
      kind: "canonical" as const,
    },
  ],
}))

it("restores open projects in saved order and ignores stale references", () => {
  const restored = restoreApplicationState(
    {
      openLocations: [
        {
          projectID: id("second"),
          location: Location.Ref.make({ directory: AbsolutePath.make("/second") }),
        },
        {
          projectID: id("missing"),
          location: Location.Ref.make({ directory: AbsolutePath.make("/missing") }),
        },
        {
          projectID: id("first"),
          location: Location.Ref.make({ directory: AbsolutePath.make("/first") }),
        },
      ],
      activeLocationKey: "/first\u0000",
    },
    projects,
  )
  expect(restored.projects.map((project) => project.project.id)).toEqual(["second", "first"])
  expect(restored.activeLocationKey).toBe("/first\u0000")
})

it("falls back to the first valid open project when the active reference is stale", () => {
  const restored = restoreApplicationState(
    {
      openLocations: [
        {
          projectID: id("second"),
          location: Location.Ref.make({ directory: AbsolutePath.make("/second") }),
        },
        {
          projectID: id("first"),
          location: Location.Ref.make({ directory: AbsolutePath.make("/first") }),
        },
      ],
      activeLocationKey: "/missing\u0000",
    },
    projects,
  )
  expect(restored.activeLocationKey).toBe("/second\u0000")
})

it("migrates two v1 projects to distinct canonical location keys", () => {
  const restored = restoreApplicationState(
    {
      version: 1,
      openProjectIDs: [id("first"), id("second")],
      activeProjectID: id("second"),
      projects: [],
    },
    projects,
  )
  expect(restored.projects.map((project) => `${project.location.directory}\u0000`)).toEqual([
    "/first\u0000",
    "/second\u0000",
  ])
  expect(restored.activeLocationKey).toBe("/second\u0000")
})
