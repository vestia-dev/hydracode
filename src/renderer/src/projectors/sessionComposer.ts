import type { SemanticGraphNode } from "../domain/graph"

export interface PromptComposerProjection {
  readonly id: string
  readonly precedingNodeID?: string
}

export function projectPromptComposer(
  sessionID: string,
  nodes: ReadonlyArray<SemanticGraphNode>,
): PromptComposerProjection {
  const timelineNodes = nodes.filter((node) => node.kind !== "tool-group")
  const precedingNode = timelineNodes.at(-1)
  return {
    id: `prompt-composer:${sessionID}:${precedingNode?.id ?? "empty"}`,
    ...(precedingNode === undefined ? {} : { precedingNodeID: precedingNode.id }),
  }
}
