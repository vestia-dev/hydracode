import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import type { SemanticGraph } from "./graph"
import { createSessionGraphIndex } from "./sessionGraphIndex"

const provenance = {
  source: "derived" as const,
  messageIDs: [],
  contentIndexes: [],
  toolCallIDs: [],
}

it.effect("indexes timeline, side nodes, and subagent launchers in one pass", () =>
  Effect.sync(() => {
    const graph: SemanticGraph = {
      nodes: [
        {
          id: "round-one",
          kind: "round",
          title: "Round",
          detail: "",
          status: "completed",
          artifacts: [],
          provenance,
          agentRunID: "round-one",
          round: { history: [] },
        },
        {
          id: "tools-one",
          kind: "round-tools",
          title: "Tools",
          detail: "",
          status: "running",
          artifacts: [],
          provenance,
          agentRunID: "round-one",
          roundTools: {
            id: "tools-one",
            provenance,
            time: { created: 2 },
            calls: [
              {
                id: "call-one",
                name: "subagent",
                input: { agent: "general" },
                detail: "Inspect",
                subagentSessionID: "child-one",
                status: "running",
                artifacts: [],
                provenance,
                time: { created: 2 },
              },
            ],
          },
        },
        {
          id: "artifacts-one",
          kind: "round-artifacts",
          title: "Changes",
          detail: "",
          status: "completed",
          artifacts: [],
          provenance,
          agentRunID: "round-one",
          roundArtifacts: {
            id: "artifacts-one",
            diff: { files: [] },
            provenance,
            time: { created: 3 },
          },
        },
      ],
      edges: [],
      completedSubagentSessionIDs: [],
    }

    const index = createSessionGraphIndex(graph)
    expect(index.timelineNodes.map((node) => node.id)).toEqual(["round-one"])
    expect(index.latestRound?.id).toBe("round-one")
    expect(index.toolsByRoundID.get("round-one")?.id).toBe("tools-one")
    expect(index.artifactsByRoundID.get("round-one")?.id).toBe("artifacts-one")
    expect(index.subagentLaunchers).toEqual([
      {
        id: "call-one",
        nodeID: "tools-one",
        roundID: "round-one",
        status: "running",
        executionMode: "foreground",
        created: 2,
        sessionIDs: ["child-one"],
      },
    ])
  }),
)
