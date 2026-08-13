import type { SessionMessage } from "@opencode-ai/client/effect"
import { DateTime } from "effect"
import type {
  GraphAgent,
  GraphArtifact,
  GraphNarrativeItem,
  GraphNodeStatus,
  GraphProvenance,
  GraphRound,
  GraphRoundArtifacts,
  GraphRoundHistoryItem,
  GraphRoundTools,
  GraphTime,
  GraphToolCall,
  GraphToolDirection,
  SemanticGraph,
  SemanticGraphEdge,
  SemanticGraphNode,
} from "../domain/graph"
import { formatToolCallDetail } from "./toolCallDetail"
import { formatToolDiffDetail, projectToolDiff } from "./toolCallDiff"

const MAX_DETAIL_LENGTH = 280
const READ_TOOLS = new Set([
  "glob",
  "grep",
  "listmcpresources",
  "listmcpresourcetemplates",
  "lsp",
  "read",
  "readmcpresource",
  "skill",
  "webfetch",
  "websearch",
])
const SHELL_TOOLS = new Set(["bash", "shell"])
const READ_ONLY_SHELL_COMMAND =
  /^(?:pwd\b|ls\b|find\b|rg\b|grep\b|cat\b|head\b|tail\b|wc\b|which\b|type\b|stat\b|file\b|jq\b|awk\b|sort\b|uniq\b|sed\b|git\s+(?:status|diff|log|show)\b|npm\s+(?:view|info|show)\b)/u
const HELP_ONLY_SHELL_COMMAND = /^(?!.*(?:`|\$\(|[<>]))\S+(?:\s+\S+)*\s+--help\s*$/u
const MUTATING_SHELL_COMMAND =
  /(?:^|\s)(?:rm|mv|cp|mkdir|touch|chmod|chown|truncate|install)\b|(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:add|install|remove|update|upgrade)\b|(?:^|\s)git\s+(?:add|commit|checkout|switch|reset|restore|clean|merge|rebase|push|pull)\b|(?:^|\s)sed\s+-[^\s]*i\b|(?:^|[^<])>{1,2}(?:[^>]|$)/u

function compactText(value: string) {
  const compacted = value.replaceAll(/\s+/g, " ").trim()
  return compacted.length <= MAX_DETAIL_LENGTH
    ? compacted
    : `${compacted.slice(0, MAX_DETAIL_LENGTH - 1)}…`
}

function timeValue(value: DateTime.Utc) {
  return DateTime.toEpochMillis(value)
}

function messageTime(message: SessionMessage.Info): GraphTime {
  const completed = "completed" in message.time ? message.time.completed : undefined
  return {
    created: timeValue(message.time.created),
    ...(completed === undefined ? {} : { completed: timeValue(completed) }),
  }
}

function provenance(
  messageIDs: string | ReadonlyArray<string>,
  contentIndexes: ReadonlyArray<number> = [],
  toolCallIDs: ReadonlyArray<string> = [],
  source: GraphProvenance["source"] = "explicit",
): GraphProvenance {
  return {
    source,
    messageIDs: typeof messageIDs === "string" ? [messageIDs] : messageIDs,
    contentIndexes,
    toolCallIDs,
  }
}

function aggregateStatus(statuses: ReadonlyArray<GraphNodeStatus>): GraphNodeStatus {
  if (statuses.some((status) => status === "error")) return "error"
  if (statuses.some((status) => status === "running")) return "running"
  return statuses.every((status) => status === "completed") ? "completed" : "idle"
}

function unique<T>(values: ReadonlyArray<T>): ReadonlyArray<T> {
  return Array.from(new Set(values))
}

function toolInputValue(
  content: SessionMessage.AssistantTool,
): string | Readonly<Record<string, unknown>> {
  return content.state.input
}

function toolMetadata(
  content: SessionMessage.AssistantTool,
): Readonly<Record<string, unknown>> | undefined {
  return content.state.status === "streaming" ? undefined : content.state.metadata
}

function toolResult(content: SessionMessage.AssistantTool) {
  if (content.state.status === "streaming" || content.state.status === "running") return undefined
  if (content.state.status === "error") return compactText(content.state.error.message)

  const output = content.state.content
    .map((part) => (part.type === "text" ? part.text : (part.name ?? part.uri)))
    .join(" ")
  return output === "" ? undefined : compactText(output)
}

function toolArtifacts(content: SessionMessage.AssistantTool): ReadonlyArray<GraphArtifact> {
  if (content.state.status === "streaming" || content.state.status === "running") return []
  return (content.state.content ?? []).flatMap((part, index) =>
    part.type === "file"
      ? [
          {
            id: `${content.id}:artifact:${index}`,
            kind: "file" as const,
            label: part.name ?? part.uri,
            uri: part.uri,
          },
        ]
      : [],
  )
}

function toolStatus(content: SessionMessage.AssistantTool): GraphNodeStatus {
  if (content.state.status === "streaming" || content.state.status === "running") return "running"
  return content.state.status === "error" ? "error" : "completed"
}

function toolTime(content: SessionMessage.AssistantTool): GraphTime {
  return {
    created: timeValue(content.time.created),
    ...(content.time.ran === undefined ? {} : { started: timeValue(content.time.ran) }),
    ...(content.time.completed === undefined
      ? {}
      : { completed: timeValue(content.time.completed) }),
  }
}

function shellCommand(input: string | Readonly<Record<string, unknown>>) {
  if (typeof input === "string") return input
  return typeof input["command"] === "string" ? input["command"] : undefined
}

function isClearlyReadOnlyShell(command: string) {
  const segments = command
    .split(/&&|\|\||[;|\n]/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "")
  return (
    segments.length > 0 &&
    segments.every(
      (segment) =>
        HELP_ONLY_SHELL_COMMAND.test(segment) ||
        (!MUTATING_SHELL_COMMAND.test(segment) && READ_ONLY_SHELL_COMMAND.test(segment)),
    )
  )
}

export function classifyToolCall(
  name: string,
  input: string | Readonly<Record<string, unknown>>,
): GraphToolDirection {
  const normalizedName = name.toLowerCase().replaceAll(/[-_]/g, "")
  if (normalizedName === "task" || normalizedName === "subagent") return "subagent"
  if (READ_TOOLS.has(normalizedName)) return "read"
  if (!SHELL_TOOLS.has(normalizedName)) return "write"
  const command = shellCommand(input)
  return command !== undefined && isClearlyReadOnlyShell(command) ? "read" : "write"
}

function toolCall(
  message: SessionMessage.Assistant,
  content: SessionMessage.AssistantTool,
  contentIndex: number,
): GraphToolCall {
  const result = toolResult(content)
  const input = toolInputValue(content)
  const metadata = toolMetadata(content)
  const diff = projectToolDiff(content.name, metadata)
  const sessionID = metadata?.["sessionId"] ?? metadata?.["sessionID"]
  return {
    id: `${message.id}:${contentIndex}`,
    name: content.name,
    input,
    detail:
      diff === undefined ? formatToolCallDetail(content.name, input) : formatToolDiffDetail(diff),
    ...(result === undefined ? {} : { result }),
    ...(diff === undefined ? {} : { diff }),
    ...(typeof sessionID === "string" ? { subagentSessionID: sessionID } : {}),
    status: toolStatus(content),
    artifacts: toolArtifacts(content),
    provenance: provenance(message.id, [contentIndex], [content.id]),
    time: toolTime(content),
  }
}

function textKind(content: SessionMessage.AssistantText): "commentary" | "response" {
  return content.state?.["phase"] === "commentary" ? "commentary" : "response"
}

function narrativeItem(
  message: SessionMessage.Assistant,
  content: SessionMessage.AssistantText | SessionMessage.AssistantReasoning,
  contentIndex: number,
): GraphNarrativeItem {
  const kind = content.type === "reasoning" ? "reasoning" : textKind(content)
  const contentTime = content.type === "reasoning" ? content.time : undefined
  return {
    id: `${message.id}:${contentIndex}`,
    kind,
    title: kind === "reasoning" ? "Reasoning" : kind === "commentary" ? "Commentary" : "Response",
    detail: content.text,
    status:
      message.error !== undefined
        ? "error"
        : message.time.completed === undefined
          ? "running"
          : "completed",
    provenance: provenance(message.id, [contentIndex]),
    ...(contentTime === undefined
      ? {}
      : {
          time: {
            created: timeValue(contentTime.created),
            ...(contentTime.completed === undefined
              ? {}
              : { completed: timeValue(contentTime.completed) }),
          },
        }),
  }
}

function uniqueArtifacts(calls: ReadonlyArray<GraphToolCall>) {
  const artifacts = new Map<string, GraphArtifact>()
  for (const call of calls) {
    for (const artifact of call.artifacts) artifacts.set(artifact.uri, artifact)
  }
  return Array.from(artifacts.values())
}

function groupTime(calls: ReadonlyArray<GraphToolCall>): GraphTime {
  const created = Math.min(...calls.map((call) => call.time.created))
  const starts = calls.flatMap((call) =>
    call.time.started === undefined ? [] : [call.time.started],
  )
  const completions = calls.flatMap((call) =>
    call.time.completed === undefined ? [] : [call.time.completed],
  )
  return {
    created,
    ...(starts.length === 0 ? {} : { started: Math.min(...starts) }),
    ...(completions.length !== calls.length ? {} : { completed: Math.max(...completions) }),
  }
}

function agentTime(messages: ReadonlyArray<SessionMessage.Assistant>): GraphTime {
  const created = Math.min(...messages.map((message) => timeValue(message.time.created)))
  const completions = messages.flatMap((message) =>
    message.time.completed === undefined ? [] : [timeValue(message.time.completed)],
  )
  return {
    created,
    ...(completions.length !== messages.length ? {} : { completed: Math.max(...completions) }),
  }
}

function summarizeAgent(messageCount: number, narrativeCount: number, errorCount: number) {
  const parts = [
    `${messageCount} ${messageCount === 1 ? "message" : "messages"}`,
    `${narrativeCount} ${narrativeCount === 1 ? "narrative" : "narratives"}`,
  ]
  if (errorCount > 0) parts.push(`${errorCount} ${errorCount === 1 ? "error" : "errors"}`)
  return parts.join(" · ")
}

function roundNode(
  input: SessionMessage.User | undefined,
  messages: ReadonlyArray<SessionMessage.Assistant>,
) {
  const first = messages[0]
  if (input === undefined && first === undefined) throw new Error("A round cannot be empty")

  const runID = `round:${input?.id ?? first?.id}`
  const narratives: Array<GraphNarrativeItem> = []
  const history: Array<GraphRoundHistoryItem> =
    input === undefined
      ? []
      : [
          {
            id: input.id,
            kind: "user",
            title: "Prompt",
            detail: input.text,
            status: "completed",
            provenance: provenance(input.id),
            time: messageTime(input),
          },
        ]
  const calls: Array<GraphToolCall> = []
  const allStatuses: Array<GraphNodeStatus> = []

  messages.forEach((message) => {
    message.content.forEach((content, contentIndex) => {
      if (content.type === "tool") {
        const call = toolCall(message, content, contentIndex)
        calls.push(call)
        allStatuses.push(call.status)
        history.push({
          id: call.id,
          kind: "tool",
          title: call.name,
          detail: call.result === undefined ? call.detail : `${call.detail}\n\n${call.result}`,
          status: call.status,
          provenance: call.provenance,
          time: call.time,
        })
        return
      }
      const narrative = narrativeItem(message, content, contentIndex)
      narratives.push(narrative)
      allStatuses.push(narrative.status)
      history.push({ ...narrative, kind: narrative.kind })
    })
    if (message.content.length === 0) {
      allStatuses.push(message.time.completed === undefined ? "running" : "completed")
    }
    if (message.error !== undefined) {
      allStatuses.push("error")
      history.push({
        id: `${message.id}:error`,
        kind: "error",
        title: "Error",
        detail: compactText(message.error.message),
        status: "error",
        provenance: provenance(message.id),
      })
    }
  })

  const messageIDs = messages.map((message) => message.id)
  const errors = messages.flatMap((message) =>
    message.error === undefined ? [] : [compactText(message.error.message)],
  )
  const agent: GraphAgent | undefined =
    messages.length === 0
      ? undefined
      : {
          messageIDs,
          agents: unique(messages.map((message) => message.agent)),
          models: unique(
            messages.map((message) => `${message.model.providerID}/${message.model.id}`),
          ),
          narratives,
          errors,
          provenance: provenance(messageIDs, [], [], "derived"),
          time: agentTime(messages),
        }
  const round: GraphRound = {
    ...(input === undefined
      ? {}
      : {
          input: {
            messageID: input.id,
            text: input.text,
            provenance: provenance(input.id),
            time: messageTime(input),
          },
        }),
    ...(agent === undefined ? {} : { agent }),
    history,
  }
  const roundProvenance = provenance(
    [...(input === undefined ? [] : [input.id]), ...messageIDs],
    [],
    [],
    "derived",
  )
  const roundTime = agent?.time ?? (input === undefined ? undefined : messageTime(input))
  const agentNode: SemanticGraphNode = {
    id: runID,
    kind: "round",
    title: "Round",
    detail:
      agent === undefined
        ? "Waiting for the agent"
        : summarizeAgent(messages.length, narratives.length, errors.length),
    status: agent === undefined ? "idle" : aggregateStatus(allStatuses),
    artifacts: [],
    provenance: roundProvenance,
    ...(roundTime === undefined ? {} : { time: roundTime }),
    agentRunID: runID,
    ...(agent === undefined ? {} : { agent }),
    round,
  }

  const sideNodes: Array<SemanticGraphNode> = []
  if (calls.length > 0) {
    const tools: GraphRoundTools = {
      id: `${runID}:tools`,
      calls,
      provenance: provenance(
        unique(calls.flatMap((call) => call.provenance.messageIDs)),
        unique(calls.flatMap((call) => call.provenance.contentIndexes)),
        calls.flatMap((call) => call.provenance.toolCallIDs),
        "derived",
      ),
      time: groupTime(calls),
    }
    sideNodes.push({
      id: tools.id,
      kind: "round-tools",
      title: "Tools",
      detail: `${calls.length} tool calls`,
      status: aggregateStatus(calls.map((call) => call.status)),
      artifacts: [],
      provenance: tools.provenance,
      time: tools.time,
      agentRunID: runID,
      roundTools: tools,
    })
  }

  const diffFiles = calls.flatMap((call) => call.diff?.files ?? [])
  if (diffFiles.length > 0) {
    const artifactCalls = calls.filter((call) => call.diff !== undefined)
    const artifacts: GraphRoundArtifacts = {
      id: `${runID}:artifacts`,
      diff: { files: diffFiles },
      provenance: provenance(
        unique(artifactCalls.flatMap((call) => call.provenance.messageIDs)),
        unique(artifactCalls.flatMap((call) => call.provenance.contentIndexes)),
        artifactCalls.flatMap((call) => call.provenance.toolCallIDs),
        "derived",
      ),
      time: groupTime(artifactCalls),
    }
    sideNodes.push({
      id: artifacts.id,
      kind: "round-artifacts",
      title: "Changes",
      detail: `${diffFiles.length} changed ${diffFiles.length === 1 ? "file" : "files"}`,
      status: aggregateStatus(artifactCalls.map((call) => call.status)),
      artifacts: uniqueArtifacts(artifactCalls),
      provenance: artifacts.provenance,
      time: artifacts.time,
      agentRunID: runID,
      roundArtifacts: artifacts,
    })
  }

  return [agentNode, ...sideNodes]
}

function messageNode(
  message: Exclude<SessionMessage.Info, SessionMessage.Assistant>,
): SemanticGraphNode {
  const common = {
    id: message.id,
    artifacts: [],
    provenance: provenance(message.id),
    time: messageTime(message),
  }
  switch (message.type) {
    case "user":
      return {
        ...common,
        kind: "input",
        title: "Prompt",
        detail: message.text,
        status: "completed",
      }
    case "synthetic":
      return {
        ...common,
        kind: "input",
        title: message.description ?? "Synthetic input",
        detail: message.text,
        status: "completed",
      }
    case "system":
      return {
        ...common,
        kind: "system",
        title: "System",
        detail: message.text,
        status: "completed",
      }
    case "skill":
      return {
        ...common,
        kind: "tool",
        title: message.name,
        detail: message.text,
        status: "completed",
      }
    case "shell":
      return {
        ...common,
        kind: "shell",
        title: "Shell",
        detail: compactText(message.command),
        status:
          message.status === "running"
            ? "running"
            : message.status === "exited"
              ? "completed"
              : "error",
      }
    case "agent-switched":
      return {
        ...common,
        kind: "system",
        title: "Agent selected",
        detail: message.agent,
        status: "completed",
      }
    case "model-switched":
      return {
        ...common,
        kind: "system",
        title: "Model selected",
        detail: `${message.model.providerID}/${message.model.id}`,
        status: "completed",
      }
    case "compaction":
      return {
        ...common,
        kind: "compaction",
        title: "Compaction",
        detail: message.status === "failed" ? message.error.message : message.summary,
        status:
          message.status === "running"
            ? "running"
            : message.status === "failed"
              ? "error"
              : "completed",
      }
    default: {
      const exhaustive: never = message
      return exhaustive
    }
  }
}

function isHiddenRoundContext(message: SessionMessage.Info | undefined) {
  return (
    message?.type === "system" ||
    (message?.type === "synthetic" && message.description === "Continuing after restart")
  )
}

function branchEdges(nodes: ReadonlyArray<SemanticGraphNode>): ReadonlyArray<SemanticGraphEdge> {
  const edges: Array<SemanticGraphEdge> = []
  const agentNodes = nodes.filter((node) => node.kind === "round")
  for (const agentNode of agentNodes) {
    const sideNodes = nodes.filter(
      (node) =>
        (node.kind === "round-tools" || node.kind === "round-artifacts") &&
        node.agentRunID === agentNode.agentRunID,
    )
    for (const sideNode of sideNodes) {
      edges.push({
        id: `${agentNode.id}->${sideNode.id}`,
        source: agentNode.id,
        target: sideNode.id,
        kind: sideNode.kind === "round-tools" ? "tools" : "artifacts",
      })
    }
  }
  return edges
}

export function projectMessages(messages: ReadonlyArray<SessionMessage.Info>): SemanticGraph {
  const nodes: Array<SemanticGraphNode> = []

  for (let index = 0; index < messages.length;) {
    const message = messages[index]
    if (message === undefined) break
    if (message.type === "user") {
      const assistantMessages: Array<SessionMessage.Assistant> = []
      index += 1
      while (index < messages.length) {
        const candidate = messages[index]
        if (candidate?.type === "assistant") assistantMessages.push(candidate)
        else if (!isHiddenRoundContext(candidate)) break
        index += 1
      }
      nodes.push(...roundNode(message, assistantMessages))
      continue
    }
    if (isHiddenRoundContext(message)) {
      index += 1
      continue
    }
    if (message.type !== "assistant") {
      nodes.push(messageNode(message))
      index += 1
      continue
    }

    const assistantMessages: Array<SessionMessage.Assistant> = []
    while (index < messages.length) {
      const candidate = messages[index]
      if (candidate?.type === "assistant") assistantMessages.push(candidate)
      else if (!isHiddenRoundContext(candidate)) break
      index += 1
    }
    nodes.push(...roundNode(undefined, assistantMessages))
  }

  const timelineNodes = nodes.filter(
    (node) => node.kind !== "round-tools" && node.kind !== "round-artifacts",
  )
  const timelineEdges: Array<SemanticGraphEdge> = timelineNodes.slice(1).map((target, index) => {
    const source = timelineNodes[index]
    if (source === undefined) throw new Error("A graph edge must have a source node")
    return {
      id: `${source.id}->${target.id}`,
      source: source.id,
      target: target.id,
      kind: "timeline",
    }
  })

  return { nodes, edges: [...timelineEdges, ...branchEdges(nodes)] }
}
