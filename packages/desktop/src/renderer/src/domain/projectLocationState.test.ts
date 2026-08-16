import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { AbsolutePath, Location, Project } from "@opencode-ai/client/effect"
import type { ProjectUpdate } from "../../../shared/project"
import type { OpenLocationState } from "../hooks/useProjectController"
import type { SemanticGraph, SemanticGraphNode } from "./graph"
import { applyProjectUpdate, preserveCompletedGraph } from "./projectLocationState"

const projectA = Schema.decodeUnknownSync(Project.ID)("project-a")
const projectB = Schema.decodeUnknownSync(Project.ID)("project-b")
const location = Location.Ref.make({ directory: AbsolutePath.make("/tmp/project-a") })
const provenance = {
  source: "explicit" as const,
  messageIDs: [],
  contentIndexes: [],
  toolCallIDs: [],
}

function graphNode(id: string, status: SemanticGraphNode["status"]): SemanticGraphNode {
  return { id, status, kind: "round", title: id, detail: id, artifacts: [], provenance }
}

function graph(nodes: ReadonlyArray<SemanticGraphNode>): SemanticGraph {
  return { nodes, edges: [], completedSubagentSessionIDs: [] }
}

function opening(projectID: Project.ID): OpenLocationState {
  return {
    locationKey: `/code/${projectID}\u0000`,
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
  it("accepts a snapshot only for its owning location state", () => {
    const state = opening(projectA)
    const foreign: ProjectUpdate = {
      _tag: "Snapshot",
      snapshot: {
        project: { id: projectB, canonical: AbsolutePath.make("/tmp/project-b") },
        location,
        sessions: [],
        recentSessions: [],
      },
    }

    expect(applyProjectUpdate(projectA, state, foreign)).toBe(state)
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
        location,
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
    const ready = applyProjectUpdate(projectA, opening(projectA), {
      _tag: "Snapshot",
      snapshot: {
        project: { id: projectA, canonical: AbsolutePath.make("/tmp/project-a") },
        location,
        sessions: [
          {
            id: "session-a",
            location,
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
    expect(ready.snapshot?.sessions[0]?.location).toEqual(location)

    const removed = applyProjectUpdate(projectA, ready, {
      _tag: "Removed",
      projectID: projectA,
      sessionID: "session-a",
    })

    expect(removed.snapshot?.sessions).toEqual([])
    expect(removed.snapshot?.recentSessions).toEqual([])
  })
})

describe("preserveCompletedGraph", () => {
  it("reuses completed history while replacing the active tail", () => {
    const completed = graphNode("completed", "completed")
    const running = graphNode("running", "running")
    const next = preserveCompletedGraph(
      graph([graphNode("completed", "completed"), graphNode("running", "completed")]),
      graph([completed, running]),
    )

    expect(next.nodes[0]).toBe(completed)
    expect(next.nodes[1]).not.toBe(running)
    expect(next.nodes[1]?.status).toBe("completed")
  })
})
