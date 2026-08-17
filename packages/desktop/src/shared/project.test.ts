import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { OpenProjectCommand, ProjectDetails } from "./project"

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
    const project = Schema.decodeUnknownSync(ProjectDetails)({
      id: "project-hydracode",
      canonical: "/code/hydracode",
      name: "HydraCode",
      icon: { url: "data:image/svg+xml,icon", color: "#663399" },
    })

    expect(project.id).toBe("project-hydracode")
    expect(project.canonical).toBe("/code/hydracode")
    expect(project.icon).toEqual({
      url: "data:image/svg+xml,icon",
      color: "#663399",
    })
  }),
)
