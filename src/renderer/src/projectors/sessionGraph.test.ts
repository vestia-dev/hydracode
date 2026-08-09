import type { SessionMessage } from "@opencode-ai/client/effect"
import { expect, it } from "@effect/vitest"
import { Brand, DateTime, Effect } from "effect"
import { classifyToolCall, projectMessages } from "./sessionGraph"
import { readBranchPositions, spokeOffset, writeBranchPositions } from "./sessionLayout"
import { spokePath } from "./spokePath"

function timestamp(value: number) {
  return DateTime.makeUnsafe(value)
}

const messageID = Brand.nominal<SessionMessage.ID>()
const agentID = Brand.nominal<SessionMessage.Assistant["agent"]>()
const modelID = Brand.nominal<SessionMessage.Assistant["model"]["id"]>()
const providerID = Brand.nominal<SessionMessage.Assistant["model"]["providerID"]>()

function userMessage() {
  return {
    id: messageID("message-user"),
    type: "user",
    text: "What is in this project?",
    time: { created: timestamp(1_000) },
  } satisfies SessionMessage.User
}

function tool(
  id: string,
  name: string,
  input: Readonly<Record<string, unknown>>,
  created: number,
  metadata?: SessionMessage.ToolStateCompleted["metadata"],
): SessionMessage.AssistantTool {
  return {
    id,
    type: "tool",
    name,
    state: {
      status: "completed",
      input,
      content: [{ type: "text", text: "ok" }],
      ...(metadata === undefined ? {} : { metadata }),
    },
    time: {
      created: timestamp(created),
      ran: timestamp(created + 1),
      completed: timestamp(created + 20),
    },
  }
}

function assistantMessage(
  id: string,
  content: ReadonlyArray<SessionMessage.AssistantContent>,
  created: number,
  finish: NonNullable<SessionMessage.Assistant["finish"]> = "tool-calls",
) {
  return {
    id: messageID(id),
    type: "assistant",
    agent: agentID("build"),
    model: { providerID: providerID("openai"), id: modelID("gpt-5") },
    content,
    finish,
    time: { created: timestamp(created), completed: timestamp(created + 100) },
  } satisfies SessionMessage.Assistant
}

function effectSessionMessages() {
  return [
    userMessage(),
    assistantMessage(
      "message-assistant-1",
      [
        { type: "text", text: "I’ll inspect the project.", state: { phase: "commentary" } },
        tool("call-glob-1", "glob", { pattern: "*" }, 2_010),
        tool("call-glob-2", "glob", { pattern: "**/package.json" }, 2_012),
        tool("call-shell-1", "shell", { command: "pwd" }, 2_040),
      ],
      2_000,
    ),
    assistantMessage(
      "message-assistant-2",
      [
        tool("call-read-1", "read", { filePath: "one.ts" }, 3_010),
        tool("call-read-2", "read", { filePath: "two.ts" }, 3_012),
        tool("call-read-3", "read", { filePath: "three.ts" }, 3_014),
        tool("call-read-4", "read", { filePath: "four.ts" }, 3_016),
        tool("call-grep", "grep", { pattern: "Layer" }, 3_020),
      ],
      3_000,
    ),
    assistantMessage(
      "message-assistant-3",
      [
        { type: "reasoning", text: "Check the package structure." },
        tool("call-read-5", "read", { filePath: "README.md" }, 4_010),
        tool("call-shell-2", "shell", { command: "find ." }, 4_020),
      ],
      4_000,
    ),
    assistantMessage(
      "message-assistant-4",
      [{ type: "text", text: "This is an Effect project." }],
      5_000,
      "stop",
    ),
  ]
}

it.effect("projects a consecutive assistant run as one Agent with read groups per message", () =>
  Effect.sync(() => {
    const graph = projectMessages(effectSessionMessages())
    const agentNode = graph.nodes.find((node) => node.kind === "agent")
    const toolGroups = graph.nodes.filter((node) => node.kind === "tool-group")

    expect(graph.nodes.map((node) => node.kind)).toEqual([
      "input",
      "agent",
      "tool-group",
      "tool-group",
      "tool-group",
    ])
    expect(graph.nodes[0]?.title).toBe("You")
    expect(agentNode?.agent?.messageIDs).toEqual([
      "message-assistant-1",
      "message-assistant-2",
      "message-assistant-3",
      "message-assistant-4",
    ])
    expect(toolGroups.map((node) => node.toolGroup?.messageIndex)).toEqual([0, 1, 2])
    expect(toolGroups.map((node) => node.toolGroup?.calls.length)).toEqual([3, 5, 2])
    expect(toolGroups.map((node) => node.toolGroup?.direction)).toEqual(["read", "read", "read"])
    expect(toolGroups[1]?.toolGroup?.calls[0]).toMatchObject({
      name: "read",
      input: { filePath: "one.ts" },
      detail: "one.ts",
    })
    expect(toolGroups[1]?.toolGroup?.calls[4]).toMatchObject({
      name: "grep",
      input: { pattern: "Layer" },
      detail: "Layer",
    })
  }),
)

it.effect("keeps commentary, reasoning, and response inside the Agent exactly once", () =>
  Effect.sync(() => {
    const graph = projectMessages(effectSessionMessages())
    const narratives = graph.nodes.find((node) => node.kind === "agent")?.agent?.narratives

    expect(narratives?.map((item) => item.kind)).toEqual(["commentary", "reasoning", "response"])
    expect(narratives?.map((item) => item.detail)).toEqual([
      "I’ll inspect the project.",
      "Check the package structure.",
      "This is an Effect project.",
    ])
  }),
)

it.effect("preserves message whitespace so Markdown structure reaches the renderer", () =>
  Effect.sync(() => {
    const markdown = "## Summary\n\n- first\n- second\n\n```ts\nconst value = 1\n```"
    const graph = projectMessages([
      {
        id: messageID("message-user-markdown"),
        type: "user",
        text: markdown,
        time: { created: timestamp(1_000) },
      },
      assistantMessage("message-assistant-markdown", [{ type: "text", text: markdown }], 2_000),
    ])

    expect(graph.nodes.find((node) => node.kind === "input")?.detail).toBe(markdown)
    expect(graph.nodes.find((node) => node.kind === "agent")?.agent?.narratives[0]?.detail).toBe(
      markdown,
    )
  }),
)

it.effect("branches reads upward in message order and writes downward in message order", () =>
  Effect.sync(() => {
    const graph = projectMessages([
      userMessage(),
      assistantMessage(
        "message-assistant-1",
        [
          tool("call-read", "read", { filePath: "one.ts" }, 2_010),
          tool("call-patch", "apply_patch", { patchText: "*** Begin Patch" }, 2_020),
        ],
        2_000,
      ),
      assistantMessage(
        "message-assistant-2",
        [
          tool("call-grep", "grep", { pattern: "Layer" }, 3_010),
          tool("call-shell", "shell", { command: "bun test" }, 3_020),
        ],
        3_000,
      ),
    ])

    expect(graph.edges.map((edge) => [edge.kind, edge.source, edge.target])).toEqual([
      ["timeline", "message-user", "agent:message-assistant-1"],
      ["read", "agent:message-assistant-1", "tool-group:message-assistant-1:read"],
      ["read", "agent:message-assistant-1", "tool-group:message-assistant-2:read"],
      ["write", "agent:message-assistant-1", "tool-group:message-assistant-1:write"],
      ["write", "agent:message-assistant-1", "tool-group:message-assistant-2:write"],
    ])

    const anchor = { x: 252, y: 480 }
    const nodeDistance = { horizontal: 32, vertical: 24 }
    const branchSizes = [
      { width: 240, height: 78 },
      { width: 240, height: 109 },
    ]
    expect(readBranchPositions(anchor, 300, branchSizes, nodeDistance)).toEqual([
      { x: 146, y: 347 },
      { x: 418, y: 347 },
    ])
    expect(writeBranchPositions(anchor, 300, 220, branchSizes, nodeDistance)).toEqual([
      { x: 146, y: 724 },
      { x: 418, y: 724 },
    ])
    expect(Array.from({ length: 3 }, (_, index) => spokeOffset(index, 3))).toEqual([
      "25%",
      "50%",
      "75%",
    ])
  }),
)

it.effect("splits read and write calls from the same assistant message into two groups", () =>
  Effect.sync(() => {
    const graph = projectMessages([
      assistantMessage(
        "message-assistant",
        [
          { type: "text", text: "I’ll inspect and update it.", state: { phase: "commentary" } },
          tool("call-read", "read", { filePath: "one.ts" }, 1_010),
          tool("call-shell-read", "shell", { command: "rg Layer src | head" }, 1_020),
          tool("call-edit", "edit", { filePath: "one.ts" }, 1_030),
          tool("call-shell-action", "shell", { command: "bun run build" }, 1_040),
        ],
        1_000,
      ),
    ])
    const groups = graph.nodes.flatMap((node) =>
      node.toolGroup === undefined ? [] : [node.toolGroup],
    )

    expect(groups.map((group) => group.direction)).toEqual(["read", "write"])
    expect(groups[0]?.calls.map((call) => call.name)).toEqual(["read", "shell"])
    expect(groups[1]?.calls.map((call) => call.name)).toEqual(["edit", "shell"])
    expect(groups.every((group) => group.messageID === "message-assistant")).toBe(true)
  }),
)

it.effect("classifies shell conservatively and defaults unknown tools to actions", () =>
  Effect.sync(() => {
    expect(classifyToolCall("task", { subagent_type: "explore" })).toBe("subagent")
    expect(classifyToolCall("subagent", { agent: "general" })).toBe("subagent")
    expect(classifyToolCall("webfetch", { url: "https://example.com" })).toBe("read")
    expect(classifyToolCall("shell", { command: "git status && rg TODO src" })).toBe("read")
    expect(classifyToolCall("shell", { command: "rg TODO src > todos.txt" })).toBe("write")
    expect(classifyToolCall("shell", { command: "bun test" })).toBe("write")
    expect(classifyToolCall("apply_patch", { patchText: "*** Begin Patch" })).toBe("write")
    expect(classifyToolCall("custom-tool", {})).toBe("write")
  }),
)

it.effect("projects task calls as linked subagent branches", () =>
  Effect.sync(() => {
    const graph = projectMessages([
      assistantMessage(
        "message-assistant-task",
        [
          tool(
            "call-task",
            "task",
            { description: "Inspect sessions", subagent_type: "explore" },
            1_010,
            { sessionId: "session-child" },
          ),
        ],
        1_000,
      ),
    ])
    const group = graph.nodes.find((node) => node.toolGroup?.direction === "subagent")

    expect(group?.title).toBe("Subagent")
    expect(group?.toolGroup?.calls[0]?.subagentSessionID).toBe("session-child")
    expect(graph.edges).toContainEqual({
      id: `agent:message-assistant-task->${group?.id}`,
      source: "agent:message-assistant-task",
      target: group?.id,
      kind: "subagent",
    })
  }),
)

it.effect("projects authoritative apply_patch metadata for diff rendering", () =>
  Effect.sync(() => {
    const patch = "--- src/app.ts\n+++ src/app.ts\n@@ -1 +1 @@\n-old\n+new"
    const graph = projectMessages([
      assistantMessage(
        "message-assistant-patch",
        [
          tool(
            "call-patch",
            "apply_patch",
            { patchText: "*** Begin Patch\n*** Update File: src/app.ts\n*** End Patch" },
            1_010,
            {
              files: [
                {
                  filePath: "/code/src/app.ts",
                  relativePath: "src/app.ts",
                  type: "update",
                  patch,
                  additions: 1,
                  deletions: 1,
                },
              ],
            },
          ),
        ],
        1_000,
      ),
    ])
    const call = graph.nodes.find((node) => node.toolGroup !== undefined)?.toolGroup?.calls[0]

    expect(call?.detail).toBe("1 file · +1 -1")
    expect(call?.diff).toEqual({
      files: [
        {
          path: "src/app.ts",
          status: "modified",
          patch,
          additions: 1,
          deletions: 1,
        },
      ],
    })
  }),
)

it.effect("retains grouped provenance and tool timing", () =>
  Effect.sync(() => {
    const graph = projectMessages([
      assistantMessage(
        "message-assistant",
        [tool("call-read", "read", { filePath: "one.ts" }, 1_010)],
        1_000,
      ),
    ])
    const group = graph.nodes.find((node) => node.kind === "tool-group")

    expect(group?.provenance).toEqual({
      source: "derived",
      messageIDs: ["message-assistant"],
      contentIndexes: [0],
      toolCallIDs: ["call-read"],
    })
    expect(group?.toolGroup?.calls[0]?.time).toEqual({
      created: 1_010,
      started: 1_011,
      completed: 1_030,
    })
  }),
)

it.effect("routes spokes through a source-side corridor with rounded bends", () =>
  Effect.sync(() => {
    expect(spokePath({ sourceX: 100, sourceY: 200, targetX: 40, targetY: 100 })).toBe(
      "M 100 200 L 100 192 Q 100 184 92 184 L 48 184 Q 40 184 40 176 L 40 100",
    )
    expect(spokePath({ sourceX: 100, sourceY: 200, targetX: 160, targetY: 300 })).toBe(
      "M 100 200 L 100 208 Q 100 216 108 216 L 152 216 Q 160 216 160 224 L 160 300",
    )
    expect(spokePath({ sourceX: 100, sourceY: 200, targetX: 100, targetY: 100 })).toBe(
      "M 100 200 L 100 100",
    )
  }),
)
