import type { GraphNodeStatus, GraphToolCall } from "../domain/graph"

export interface GroupedToolCalls {
  readonly name: string
  readonly calls: ReadonlyArray<GraphToolCall>
  readonly status: GraphNodeStatus
}

export function toolGroupExpansionKey(toolGroupID: string, toolName: string) {
  return `${toolGroupID}:${toolName}`
}

export function toolCallExpansionKey(toolGroupID: string, toolCallID: string) {
  return `${toolGroupID}:call:${toolCallID}`
}

function aggregateStatus(calls: ReadonlyArray<GraphToolCall>): GraphNodeStatus {
  if (calls.some((call) => call.status === "error")) return "error"
  if (calls.some((call) => call.status === "running")) return "running"
  return calls.every((call) => call.status === "completed") ? "completed" : "idle"
}

export function groupToolCalls(
  calls: ReadonlyArray<GraphToolCall>,
): ReadonlyArray<GroupedToolCalls> {
  const groups = new Map<string, Array<GraphToolCall>>()
  for (const call of calls) {
    const group = groups.get(call.name)
    if (group === undefined) {
      groups.set(call.name, [call])
      continue
    }
    group.push(call)
  }
  return Array.from(groups, ([name, groupedCalls]) => ({
    name,
    calls: groupedCalls,
    status: aggregateStatus(groupedCalls),
  }))
}

export function visibleToolRowCount(
  toolGroupID: string,
  calls: ReadonlyArray<GraphToolCall>,
  expandedGroups: ReadonlySet<string>,
) {
  return groupToolCalls(calls).reduce(
    (rows, group) =>
      rows +
      1 +
      (group.calls.length > 1 && expandedGroups.has(toolGroupExpansionKey(toolGroupID, group.name))
        ? group.calls.length
        : 0),
    0,
  )
}
