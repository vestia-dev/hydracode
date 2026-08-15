import type { SemanticGraphNode } from "./graph"

export interface PromptComposerState {
  readonly id: string
  readonly precedingNodeID?: string
}

export function createPromptComposerState(
  sessionID: string,
  nodes: ReadonlyArray<SemanticGraphNode>,
): PromptComposerState {
  const timelineNodes = nodes.filter(
    (node) => node.kind !== "round-tools" && node.kind !== "round-artifacts",
  )
  const precedingNode = timelineNodes.at(-1)
  return {
    id: `prompt-composer:${sessionID}:${precedingNode?.id ?? "empty"}`,
    ...(precedingNode === undefined ? {} : { precedingNodeID: precedingNode.id }),
  }
}
