import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { OpenProjectCommand, ProjectSnapshot } from "./project"

it.effect("preserves a remote workspace location when opening a project", () =>
  Effect.sync(() => {
    const command = Schema.decodeUnknownSync(OpenProjectCommand)({
      location: {
        directory: "/workspace/hydracode",
        workspaceID: "wrk_remote",
      },
    })

    expect(command.location).toEqual({
      directory: "/workspace/hydracode",
      workspaceID: "wrk_remote",
    })
  }),
)

it.effect("keeps project identity separate from its active location", () =>
  Effect.sync(() => {
    const snapshot = Schema.decodeUnknownSync(ProjectSnapshot)({
      project: {
        id: "project-hydracode",
        canonical: "/code/hydracode",
        name: "HydraCode",
        icon: { url: "data:image/svg+xml,icon", color: "#663399" },
      },
      location: {
        directory: "/workspace/hydracode",
        workspaceID: "wrk_remote",
      },
      sessions: [],
      recentSessions: [],
    })

    expect(snapshot.project.id).toBe("project-hydracode")
    expect(snapshot.project.canonical).toBe("/code/hydracode")
    expect(snapshot.project.icon).toEqual({
      url: "data:image/svg+xml,icon",
      color: "#663399",
    })
    expect(snapshot.location.directory).toBe("/workspace/hydracode")
    expect(snapshot.location.workspaceID).toBe("wrk_remote")
  }),
)
