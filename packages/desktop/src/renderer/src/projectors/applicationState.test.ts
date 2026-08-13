import { Project } from "@opencode-ai/client/effect"
import { Schema } from "effect"
import { expect, it } from "vitest"
import { restoreApplicationState } from "./applicationState"

const id = (value: string) => Schema.decodeUnknownSync(Project.ID)(value)
const projects = ["third", "first", "second"].map((value) => ({ project: { id: id(value) } }))

it("restores open projects in saved order and ignores stale references", () => {
  const restored = restoreApplicationState(
    {
      openProjectIDs: [id("second"), id("missing"), id("first")],
      activeProjectID: id("first"),
    },
    projects,
  )
  expect(restored.projects.map((project) => project.project.id)).toEqual(["second", "first"])
  expect(restored.activeProjectID).toBe("first")
})

it("falls back to the first valid open project when the active reference is stale", () => {
  const restored = restoreApplicationState(
    {
      openProjectIDs: [id("second"), id("first")],
      activeProjectID: id("missing"),
    },
    projects,
  )
  expect(restored.activeProjectID).toBe("second")
})
