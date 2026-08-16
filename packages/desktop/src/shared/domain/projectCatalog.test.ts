import { expect, it } from "@effect/vitest"
import { AbsolutePath, Location, Project } from "@opencode-ai/client/effect"
import { Effect, Schema } from "effect"
import {
  availableProjects,
  createSessionSummaries,
  locationsEqual,
  locationKey,
  mergeProjectCatalogEntry,
  projectCatalogMatches,
  resolvedProjectDirectory,
  selectedSessionFamily,
} from "./projectCatalog"

const sessions = [
  { id: "older-root", created: 1_000, title: "Older" },
  { id: "child", parentID: "newer-root", created: 2_100, title: "Child" },
  { id: "grandchild", parentID: "child", created: 2_200, title: "Grandchild" },
  { id: "newer-root", created: 2_000, title: "Newer" },
]

it.effect("lists only root sessions newest first and carries descendant activity", () =>
  Effect.sync(() => {
    expect(createSessionSummaries(sessions, new Set(["grandchild"]))).toEqual([
      { id: "newer-root", created: 2_000, title: "Newer", active: true },
      { id: "older-root", created: 1_000, title: "Older", active: false },
    ])
  }),
)

it.effect("matches exact session locations", () =>
  Effect.sync(() => {
    const directory = AbsolutePath.make("/code/project")
    const location = Location.Ref.make({ directory })
    expect(locationsEqual(location, Location.Ref.make({ directory }))).toBe(true)
    expect(
      locationsEqual(location, Location.Ref.make({ directory: AbsolutePath.make("/code/other") })),
    ).toBe(false)
    expect(
      locationsEqual(
        location,
        Schema.decodeUnknownSync(Location.Ref)({ directory, workspaceID: "wrk_example" }),
      ),
    ).toBe(false)
  }),
)

it.effect("derives a stable identity for a directory and workspace", () =>
  Effect.sync(() => {
    const directory = AbsolutePath.make("/code/project")
    expect(locationKey(Location.Ref.make({ directory }))).toBe("/code/project\u0000")
    expect(
      locationKey(Schema.decodeUnknownSync(Location.Ref)({ directory, workspaceID: "wrk_remote" })),
    ).toBe("/code/project\u0000wrk_remote")
  }),
)

it.effect("selects a session's complete root family without choosing a default", () =>
  Effect.sync(() => {
    expect(selectedSessionFamily(sessions, "child")).toEqual([
      { id: "child", parentID: "newer-root", created: 2_100, title: "Child" },
      { id: "grandchild", parentID: "child", created: 2_200, title: "Grandchild" },
      { id: "newer-root", created: 2_000, title: "Newer" },
    ])
    expect(selectedSessionFamily(sessions, "missing")).toEqual([])
  }),
)

it.effect("lists known projects by recent activity with the global fallback last", () =>
  Effect.sync(() => {
    const decode = Schema.decodeUnknownSync(Project.Info)
    const projects = availableProjects([
      decode({
        id: Project.ID.global,
        canonical: "/",
        time: { created: 1, updated: 3 },
        sandboxes: [],
      }),
      decode({
        id: "older-project",
        canonical: "/code/older",
        name: "Older",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      }),
      decode({
        id: "newer-project",
        canonical: "/code/newer",
        name: "   ",
        icon: { color: "#663399" },
        time: { created: 1, updated: 2 },
        sandboxes: [],
      }),
    ])

    expect(projects.map((item) => item.project.id)).toEqual([
      "newer-project",
      "older-project",
      Project.ID.global,
    ])
    expect(projects[0]?.locations[0]?.ref.directory).toBe("/code/newer")
    expect(projects[0]?.project.name).toBeUndefined()
    expect(projects[0]?.project.icon?.color).toBe("#663399")
    expect(projects[2]?.locations[0]?.ref.directory).toBe("/")
  }),
)

it.effect("searches one catalog project across its name and all locations", () =>
  Effect.sync(() => {
    const project = {
      project: {
        id: Schema.decodeUnknownSync(Project.ID)("project"),
        canonical: AbsolutePath.make("/code/main"),
        name: "Hydra",
      },
      locations: [
        {
          ref: Location.Ref.make({ directory: AbsolutePath.make("/code/main") }),
          kind: "canonical" as const,
        },
        {
          ref: Location.Ref.make({ directory: AbsolutePath.make("/tmp/sandbox") }),
          kind: "sandbox" as const,
        },
      ],
      updated: 0,
    }
    expect(projectCatalogMatches(project, "Hydra")).toBe(true)
    expect(projectCatalogMatches(project, "sandbox")).toBe(true)
    expect(projectCatalogMatches(project, "missing")).toBe(false)
  }),
)

it.effect("preserves a selected directory for the global project fallback", () =>
  Effect.sync(() => {
    const selected = AbsolutePath.make("/Users/example/Documents/code")
    const root = AbsolutePath.make("/")
    expect(resolvedProjectDirectory(Project.ID.global, root, selected)).toBe(selected)
    expect(
      resolvedProjectDirectory(
        Schema.decodeUnknownSync(Project.ID)("git-project"),
        AbsolutePath.make("/Users/example/Documents/code/project"),
        selected,
      ),
    ).toBe("/Users/example/Documents/code/project")
  }),
)

it.effect("adds a selected folder to the global project locations", () =>
  Effect.sync(() => {
    const root = Location.Ref.make({ directory: AbsolutePath.make("/") })
    const selected = Location.Ref.make({
      directory: AbsolutePath.make("/Users/example/Documents/code"),
    })
    const projects = mergeProjectCatalogEntry(
      [
        {
          project: { id: Project.ID.global, canonical: AbsolutePath.make("/") },
          locations: [{ ref: root, kind: "canonical" as const }],
          updated: 0,
        },
      ],
      {
        project: { id: Project.ID.global, canonical: AbsolutePath.make("/") },
        locations: [{ ref: selected, kind: "selected" as const }],
        updated: 1,
      },
    )

    expect(projects[0]?.locations.map((location) => location.ref.directory)).toEqual([
      "/",
      "/Users/example/Documents/code",
    ])
  }),
)

it.effect("adds Global when the project service omits the global fallback", () =>
  Effect.sync(() => {
    const projects = availableProjects([])
    expect(projects).toHaveLength(1)
    expect(projects[0]?.project.id).toBe(Project.ID.global)
    expect(projects[0]?.locations[0]?.ref.directory).toBe("/")
  }),
)
