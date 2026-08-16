import type {
  SemanticGraph,
  SemanticGraphNode,
  SemanticEventNode,
  SemanticRoundArtifactsNode,
  SemanticRoundNode,
  SemanticRoundToolsNode,
} from "./graph"
import { classifyToolCall } from "./sessionGraph"

export interface SubagentLauncherIndexEntry {
  readonly id: string
  readonly nodeID: string
  readonly roundID: string
  readonly status: SemanticGraphNode["status"]
  readonly executionMode: "foreground" | "background"
  readonly created: number
  readonly sessionIDs: ReadonlyArray<string>
}

export interface SessionGraphIndex {
  readonly nodeByID: ReadonlyMap<string, SemanticGraphNode>
  readonly timelineNodes: ReadonlyArray<SemanticRoundNode | SemanticEventNode>
  readonly roundNodes: ReadonlyArray<SemanticRoundNode>
  readonly firstTimelineNode: SemanticRoundNode | SemanticEventNode | undefined
  readonly latestRound: SemanticRoundNode | undefined
  readonly toolsByRoundID: ReadonlyMap<string, SemanticRoundToolsNode>
  readonly artifactsByRoundID: ReadonlyMap<string, SemanticRoundArtifactsNode>
  readonly subagentLaunchers: ReadonlyArray<SubagentLauncherIndexEntry>
}

export function createSessionGraphIndex(graph: SemanticGraph): SessionGraphIndex {
  const nodeByID = new Map<string, SemanticGraphNode>()
  const timelineNodes: Array<SemanticRoundNode | SemanticEventNode> = []
  const roundNodes: Array<SemanticRoundNode> = []
  const toolsByRoundID = new Map<string, SemanticRoundToolsNode>()
  const artifactsByRoundID = new Map<string, SemanticRoundArtifactsNode>()
  const subagentLaunchers: Array<SubagentLauncherIndexEntry> = []

  for (const node of graph.nodes) {
    nodeByID.set(node.id, node)
    switch (node.kind) {
      case "round":
        timelineNodes.push(node)
        roundNodes.push(node)
        break
      case "round-tools":
        toolsByRoundID.set(node.agentRunID, node)
        for (const call of node.roundTools.calls) {
          if (classifyToolCall(call.name, call.input) !== "subagent") continue
          subagentLaunchers.push({
            id: call.id,
            nodeID: node.id,
            roundID: node.agentRunID,
            status: call.status,
            executionMode: call.executionMode ?? "foreground",
            created: call.time.created,
            sessionIDs: call.subagentSessionID === undefined ? [] : [call.subagentSessionID],
          })
        }
        break
      case "round-artifacts":
        artifactsByRoundID.set(node.agentRunID, node)
        break
      default:
        timelineNodes.push(node)
    }
  }

  return {
    nodeByID,
    timelineNodes,
    roundNodes,
    firstTimelineNode: timelineNodes[0],
    latestRound: roundNodes.at(-1),
    toolsByRoundID,
    artifactsByRoundID,
    subagentLaunchers,
  }
}
