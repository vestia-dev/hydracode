import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { AbsolutePath, Location, Project } from "@opencode-ai/client/effect"
import type { ProjectUpdate } from "../../../shared/project"
import type { OpenProjectRuntime } from "../hooks/useProjectController"
import { applyProjectUpdate } from "./projectRuntime"

const projectA = Schema.decodeUnknownSync(Project.ID)("project-a")
const projectB = Schema.decodeUnknownSync(Project.ID)("project-b")
const location = Location.Ref.make({ directory: AbsolutePath.make("/tmp/project-a") })

function opening(projectID: Project.ID): OpenProjectRuntime {
  return {
    projectID,
    location,
    status: "opening",
    snapshot: undefined,
    error: undefined,
    promptRetry: null,
    landingError: null,
  }
}

describe("applyProjectUpdate", () => {
  it("accepts a snapshot only for its owning runtime", () => {
    const runtime = opening(projectA)
    const foreign: ProjectUpdate = {
      _tag: "Snapshot",
      snapshot: {
        project: { id: projectB, canonical: AbsolutePath.make("/tmp/project-b") },
        location,
        sessions: [],
        recentSessions: [],
      },
    }

    expect(applyProjectUpdate(projectA, runtime, foreign)).toBe(runtime)
  })

  it("keeps another project's session updates isolated", () => {
    const ready = applyProjectUpdate(projectA, opening(projectA), {
      _tag: "Snapshot",
      snapshot: {
        project: { id: projectA, canonical: AbsolutePath.make("/tmp/project-a") },
        location,
        sessions: [],
        recentSessions: [],
      },
    })
    const foreign: ProjectUpdate = {
      _tag: "Session",
      projectID: projectB,
      session: {
        id: "session-b",
        created: 1,
        title: "Foreign session",
        active: true,
        synchronized: true,
        execution: { _tag: "Running" },
        messages: [],
        questions: [],
      },
    }

    expect(applyProjectUpdate(projectA, ready, foreign)).toBe(ready)
  })

  it("still removes sessions through explicit removal updates", () => {
    const hydrated = applyProjectUpdate(projectA, opening(projectA), {
      _tag: "Snapshot",
      snapshot: {
        project: { id: projectA, canonical: AbsolutePath.make("/tmp/project-a") },
        location,
        sessions: [
          {
            id: "session-a",
            created: 1,
            title: "Hydrated session",
            active: false,
            synchronized: true,
            execution: { _tag: "Idle" },
            messages: [],
            questions: [],
          },
        ],
        recentSessions: [
          {
            id: "session-a",
            created: 1,
            title: "Hydrated session",
            active: false,
          },
        ],
      },
    })

    const removed = applyProjectUpdate(projectA, hydrated, {
      _tag: "Removed",
      projectID: projectA,
      sessionID: "session-a",
    })

    expect(removed.snapshot?.sessions).toEqual([])
    expect(removed.snapshot?.recentSessions).toEqual([])
  })
})
