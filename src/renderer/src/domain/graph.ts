export type GraphNodeKind =
  | "input"
  | "agent"
  | "tool-group"
  | "tool"
  | "system"
  | "shell"
  | "compaction"

export type GraphNodeStatus = "idle" | "running" | "completed" | "error"

export type GraphArtifactKind = "file" | "source"

export interface GraphArtifact {
  readonly id: string
  readonly kind: GraphArtifactKind
  readonly label: string
  readonly uri: string
}

export interface GraphProvenance {
  readonly source: "explicit" | "derived"
  readonly messageIDs: ReadonlyArray<string>
  readonly contentIndexes: ReadonlyArray<number>
  readonly toolCallIDs: ReadonlyArray<string>
}

export interface GraphTime {
  readonly created: number
  readonly started?: number
  readonly completed?: number
}

export interface GraphToolCall {
  readonly id: string
  readonly name: string
  readonly input: string | Readonly<Record<string, unknown>>
  readonly detail: string
  readonly result?: string
  readonly diff?: GraphToolDiff
  readonly subagentSessionID?: string
  readonly status: GraphNodeStatus
  readonly artifacts: ReadonlyArray<GraphArtifact>
  readonly provenance: GraphProvenance
  readonly time: GraphTime
}

export interface GraphToolDiff {
  readonly files: ReadonlyArray<GraphToolDiffFile>
}

export interface GraphToolDiffFile {
  readonly path: string
  readonly status: "added" | "deleted" | "modified" | "moved"
  readonly patch: string
  readonly additions: number
  readonly deletions: number
}

export interface GraphNarrativeItem {
  readonly id: string
  readonly kind: "commentary" | "reasoning" | "response"
  readonly title: string
  readonly detail: string
  readonly status: GraphNodeStatus
  readonly provenance: GraphProvenance
  readonly time?: GraphTime
}

export interface GraphAgent {
  readonly messageIDs: ReadonlyArray<string>
  readonly agents: ReadonlyArray<string>
  readonly models: ReadonlyArray<string>
  readonly narratives: ReadonlyArray<GraphNarrativeItem>
  readonly errors: ReadonlyArray<string>
  readonly provenance: GraphProvenance
  readonly time: GraphTime
}

export type GraphToolDirection = "read" | "write" | "subagent"

export interface GraphMessageToolGroup {
  readonly id: string
  readonly messageID: string
  readonly messageIndex: number
  readonly direction: GraphToolDirection
  readonly calls: ReadonlyArray<GraphToolCall>
  readonly status: GraphNodeStatus
  readonly provenance: GraphProvenance
  readonly time: GraphTime
}

export interface SemanticGraphNode {
  readonly id: string
  readonly kind: GraphNodeKind
  readonly title: string
  readonly detail: string
  readonly status: GraphNodeStatus
  readonly artifacts: ReadonlyArray<GraphArtifact>
  readonly provenance: GraphProvenance
  readonly time?: GraphTime
  readonly agentRunID?: string
  readonly branchIndex?: number
  readonly agent?: GraphAgent
  readonly toolGroup?: GraphMessageToolGroup
}

export interface SemanticGraphEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly kind: "timeline" | "read" | "write" | "subagent"
}

export interface SemanticGraph {
  readonly nodes: ReadonlyArray<SemanticGraphNode>
  readonly edges: ReadonlyArray<SemanticGraphEdge>
}
