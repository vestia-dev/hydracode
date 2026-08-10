import { expect, it } from "@effect/vitest"
import { Project } from "@opencode-ai/client/effect"
import { Effect, Schema } from "effect"
import {
  projectCatalogItems,
  projectSessionSummaries,
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
    expect(projectSessionSummaries(sessions, new Set(["grandchild"]))).toEqual([
      { id: "newer-root", created: 2_000, title: "Newer", active: true },
      { id: "older-root", created: 1_000, title: "Older", active: false },
    ])
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

it.effect("lists known projects by recent activity and excludes the global fallback", () =>
  Effect.sync(() => {
    const decode = Schema.decodeUnknownSync(Project.Info)
    const projects = projectCatalogItems([
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

    expect(projects.map((item) => item.project.id)).toEqual(["newer-project", "older-project"])
    expect(projects[0]?.location.directory).toBe("/code/newer")
    expect(projects[0]?.project.name).toBeUndefined()
    expect(projects[0]?.project.icon?.color).toBe("#663399")
  }),
)
