import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { OpenedProject, OpenProjectCommand } from "./project"

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
    const opened = Schema.decodeUnknownSync(OpenedProject)({
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
      activeSessionIDs: [],
    })

    expect(opened.project.id).toBe("project-hydracode")
    expect(opened.project.canonical).toBe("/code/hydracode")
    expect(opened.project.icon).toEqual({
      url: "data:image/svg+xml,icon",
      color: "#663399",
    })
    expect(opened.location.directory).toBe("/workspace/hydracode")
    expect(opened.location.workspaceID).toBe("wrk_remote")
  }),
)
