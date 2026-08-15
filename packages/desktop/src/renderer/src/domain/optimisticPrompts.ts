import { Session, type SessionMessage } from "@opencode-ai/client/effect"
import type { SemanticGraph, SemanticGraphEdge, SemanticGraphNode } from "./graph"

export interface OptimisticPrompt {
  readonly id: string
  readonly text: string
  readonly created: number
  readonly baselineMessageIDs: ReadonlyArray<string>
}

export const createProvisionalSessionID = () => Session.ID.create()

export function reconcileOptimisticPrompts(
  prompts: ReadonlyArray<OptimisticPrompt>,
  messages: ReadonlyArray<SessionMessage.Info>,
) {
  const claimed = new Set<string>()
  return prompts.filter((prompt) => {
    const baseline = new Set(prompt.baselineMessageIDs)
    const authoritative = messages.find(
      (message) =>
        message.type === "user" &&
        !baseline.has(message.id) &&
        !claimed.has(message.id) &&
        message.text === prompt.text,
    )
    if (authoritative === undefined) return true
    claimed.add(authoritative.id)
    return false
  })
}

function promptNode(prompt: OptimisticPrompt): SemanticGraphNode {
  const provenance = {
    source: "derived" as const,
    messageIDs: [],
    contentIndexes: [],
    toolCallIDs: [],
  }
  const time = { created: prompt.created }
  return {
    id: prompt.id,
    kind: "round",
    title: "Round",
    detail: "Waiting for the agent",
    status: "idle",
    artifacts: [],
    provenance,
    time,
    agentRunID: prompt.id,
    round: {
      input: { messageID: prompt.id, text: prompt.text, provenance, time },
      history: [
        {
          id: prompt.id,
          kind: "user",
          title: "Prompt",
          detail: prompt.text,
          status: "completed",
          provenance,
          time,
        },
      ],
    },
  }
}

export function applyOptimisticPrompts(
  graph: SemanticGraph,
  prompts: ReadonlyArray<OptimisticPrompt>,
): SemanticGraph {
  if (prompts.length === 0) return graph
  const optimisticNodes = prompts.map(promptNode)
  const timeline = graph.nodes.filter(
    (node) => node.kind !== "round-tools" && node.kind !== "round-artifacts",
  )
  const sources = [...timeline, ...optimisticNodes]
  const optimisticEdges: Array<SemanticGraphEdge> = optimisticNodes.flatMap((node, index) => {
    const source = sources[timeline.length + index - 1]
    return source === undefined
      ? []
      : [
          {
            id: `${source.id}->${node.id}`,
            source: source.id,
            target: node.id,
            kind: "timeline" as const,
          },
        ]
  })
  return {
    nodes: [...graph.nodes, ...optimisticNodes],
    edges: [...graph.edges, ...optimisticEdges],
    completedSubagentSessionIDs: graph.completedSubagentSessionIDs,
  }
}
