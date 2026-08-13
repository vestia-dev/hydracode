import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import type { SemanticGraphNode } from "../domain/graph"
import { projectPromptComposer } from "./sessionComposer"

const provenance = {
  source: "explicit" as const,
  messageIDs: [],
  contentIndexes: [],
  toolCallIDs: [],
}

function node(id: string, kind: SemanticGraphNode["kind"]): SemanticGraphNode {
  return {
    id,
    kind,
    title: id,
    detail: "",
    status: "completed",
    artifacts: [],
    provenance,
  }
}

it.effect("connects the composer after the last timeline node and ignores tool branches", () =>
  Effect.sync(() => {
    const projection = projectPromptComposer("session-1", [
      node("you-1", "input"),
      node("round-1", "round"),
      node("round-tools", "round-tools"),
      node("round-artifacts", "round-artifacts"),
    ])

    expect(projection).toEqual({
      id: "prompt-composer:session-1:round-1",
      precedingNodeID: "round-1",
    })
  }),
)

it.effect("projects a standalone composer for an empty session", () =>
  Effect.sync(() => {
    expect(projectPromptComposer("session-empty", [])).toEqual({
      id: "prompt-composer:session-empty:empty",
    })
  }),
)
