import type { GraphNodeStatus, GraphToolCall } from "./graph"

export interface ToolCallGroup {
  readonly id: string
  readonly name: string
  readonly detail: string
  readonly status: GraphNodeStatus
}

function groupStatus(calls: ReadonlyArray<GraphToolCall>): GraphNodeStatus {
  if (calls.some((call) => call.status === "error")) return "error"
  if (calls.some((call) => call.status === "running")) return "running"
  return calls.every((call) => call.status === "completed") ? "completed" : "idle"
}

export function groupToolCalls(calls: ReadonlyArray<GraphToolCall>): ReadonlyArray<ToolCallGroup> {
  const groups = new Map<string, { name: string; calls: Array<GraphToolCall> }>()
  for (const call of calls) {
    const messageID = call.provenance.messageIDs[0] ?? call.id
    const normalizedName = call.name.toLowerCase().replaceAll(/[-_]/g, "")
    const key = `${messageID}:${normalizedName}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { name: call.name, calls: [call] })
    else group.calls.push(call)
  }
  return Array.from(groups, ([key, group]) => ({
    id: key,
    name: group.name,
    detail: group.calls
      .map((call) => call.detail)
      .filter((detail) => detail !== "")
      .join(" "),
    status: groupStatus(group.calls),
  }))
}
