import type {
  GraphProvenance,
  GraphToolCall,
  SemanticGraph,
  SemanticGraphNode,
} from "../domain/graph"
import type { SessionView } from "../services/OpenCodeGateway"

const runID = "layout-lab:round"
const toolsID = `${runID}:tools`
const artifactsID = `${runID}:artifacts`

function provenance(messageID: string, toolCallIDs: ReadonlyArray<string> = []): GraphProvenance {
  return {
    source: "derived",
    messageIDs: [messageID],
    contentIndexes: [],
    toolCallIDs,
  }
}

function call(index: number, name: string, detail: string): GraphToolCall {
  const id = `layout-lab:call:${index}`
  return {
    id,
    name,
    input: detail,
    detail,
    status: "completed",
    artifacts: [],
    provenance: provenance(`layout-lab:message:${index}`, [id]),
    time: { created: index * 1_000 },
  }
}

function patchCall(index: number, detail: string, path: string): GraphToolCall {
  return {
    ...call(index, "apply_patch", detail),
    diff: {
      files: [
        {
          path,
          status: "modified",
          patch: `@@ -1,2 +1,2 @@\n-old ${index}\n+new ${index}\n context`,
          additions: 1,
          deletions: 1,
        },
      ],
    },
  }
}

export function toolLayoutFixtureGraph(): SemanticGraph {
  const calls = [
    call(1, "read", "src/renderer/src/components/SessionPane.tsx"),
    call(2, "grep", "tool-summary-node"),
    call(3, "bash", "git status --short"),
    call(4, "skill", "frontend-design"),
    patchCall(5, "Replace the tool graph", "src/renderer/src/components/SessionPane.tsx"),
    call(6, "bash", "bun run lint"),
    patchCall(7, "Update node styling", "src/renderer/src/styles.css"),
    call(8, "bash", "bun run test"),
  ]
  const diffFiles = calls.flatMap((item) => item.diff?.files ?? [])
  const roundProvenance = provenance("layout-lab:prompt")
  const toolsProvenance = provenance(
    "layout-lab:tools",
    calls.map((item) => item.id),
  )
  const round: SemanticGraphNode = {
    id: runID,
    kind: "round",
    title: "Layout fixture",
    detail: "Synthetic tool calls and changes",
    status: "completed",
    artifacts: [],
    provenance: roundProvenance,
    time: { created: 0 },
    agentRunID: runID,
    round: {
      input: {
        messageID: "layout-lab:prompt",
        text: "Render a unified tool list and the complete round diff",
        provenance: roundProvenance,
        time: { created: 0 },
      },
      agent: {
        messageIDs: calls.map((item) => item.provenance.messageIDs[0]!),
        agents: ["layout lab"],
        models: [],
        narratives: [
          {
            id: "layout-lab:narrative",
            kind: "response",
            title: "Fixture",
            detail: "One tool list above and one complete changes node below.",
            status: "completed",
            provenance: roundProvenance,
            time: { created: 1 },
          },
        ],
        errors: [],
        provenance: roundProvenance,
        time: { created: 0, completed: 1 },
      },
      history: [],
    },
  }
  const tools: SemanticGraphNode = {
    id: toolsID,
    kind: "round-tools",
    title: "Tools",
    detail: `${calls.length} tool calls`,
    status: "completed",
    artifacts: [],
    provenance: toolsProvenance,
    time: { created: 1 },
    agentRunID: runID,
    roundTools: { id: toolsID, calls, provenance: toolsProvenance, time: { created: 1 } },
  }
  const artifacts: SemanticGraphNode = {
    id: artifactsID,
    kind: "round-artifacts",
    title: "Changes",
    detail: `${diffFiles.length} changed files`,
    status: "completed",
    artifacts: [],
    provenance: toolsProvenance,
    time: { created: 1 },
    agentRunID: runID,
    roundArtifacts: {
      id: artifactsID,
      diff: { files: diffFiles },
      provenance: toolsProvenance,
      time: { created: 1 },
    },
  }

  return {
    nodes: [round, tools, artifacts],
    edges: [
      { id: `${runID}->${toolsID}`, source: runID, target: toolsID, kind: "tools" },
      { id: `${runID}->${artifactsID}`, source: runID, target: artifactsID, kind: "artifacts" },
    ],
  }
}

export function toolLayoutFixture(session: SessionView): SessionView {
  return {
    ...session,
    title: "Layout lab",
    active: false,
    graph: toolLayoutFixtureGraph(),
  }
}
