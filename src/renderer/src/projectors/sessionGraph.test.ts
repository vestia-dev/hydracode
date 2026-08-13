import type { SessionMessage } from "@opencode-ai/client/effect"
import { expect, it } from "@effect/vitest"
import { Brand, DateTime, Effect } from "effect"
import { classifyToolCall, projectMessages } from "./sessionGraph"
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

function systemMessage(id: string, created: number) {
  return {
    id: messageID(id),
    type: "system",
    text: "Session context refreshed.",
    time: { created: timestamp(created) },
  } satisfies SessionMessage.System
}

function restartMessage(created: number) {
  return {
    id: messageID("message-restart"),
    type: "synthetic",
    text: "The server restarted while you were working. Continue from where you left off without repeating completed work.",
    description: "Continuing after restart",
    time: { created: timestamp(created) },
  } satisfies SessionMessage.Synthetic
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

it.effect("projects a user prompt and consecutive assistant run as one round", () =>
  Effect.sync(() => {
    const graph = projectMessages(effectSessionMessages())
    const roundNode = graph.nodes.find((node) => node.kind === "round")
    const tools = graph.nodes.find((node) => node.kind === "round-tools")?.roundTools

    expect(graph.nodes.map((node) => node.kind)).toEqual(["round", "round-tools"])
    expect(roundNode?.round?.input?.text).toBe("What is in this project?")
    expect(roundNode?.agent?.messageIDs).toEqual([
      "message-assistant-1",
      "message-assistant-2",
      "message-assistant-3",
      "message-assistant-4",
    ])
    expect(tools?.calls).toHaveLength(10)
    expect(tools?.calls[3]).toMatchObject({
      name: "read",
      input: { filePath: "one.ts" },
      detail: "one.ts",
    })
    expect(tools?.calls[7]).toMatchObject({
      name: "grep",
      input: { pattern: "Layer" },
      detail: "Layer",
    })
  }),
)

it.effect("hides system messages without splitting their surrounding round", () =>
  Effect.sync(() => {
    const graph = projectMessages([
      userMessage(),
      assistantMessage(
        "message-assistant-1",
        [tool("call-subagent-1", "subagent", { agent: "general" }, 2_010)],
        2_000,
      ),
      systemMessage("message-system", 3_000),
      assistantMessage(
        "message-assistant-2",
        [tool("call-subagent-2", "subagent", { agent: "general" }, 4_010)],
        4_000,
      ),
      assistantMessage(
        "message-assistant-3",
        [tool("call-subagent-3", "subagent", { agent: "general" }, 5_010)],
        5_000,
      ),
    ])

    expect(graph.nodes.filter((node) => node.kind === "round")).toHaveLength(1)
    expect(graph.nodes.find((node) => node.kind === "round-tools")?.roundTools?.calls).toHaveLength(
      3,
    )
    expect(graph.nodes.some((node) => node.kind === "system")).toBe(false)
  }),
)

it.effect("hides restart context without splitting the surrounding round", () =>
  Effect.sync(() => {
    const graph = projectMessages([
      userMessage(),
      assistantMessage(
        "message-assistant-before-restart",
        [{ type: "text", text: "Work before restart." }],
        2_000,
      ),
      restartMessage(3_000),
      systemMessage("message-system-after-restart", 3_100),
      assistantMessage(
        "message-assistant-after-restart",
        [{ type: "text", text: "Work after restart." }],
        4_000,
      ),
    ])

    expect(graph.nodes.filter((node) => node.kind === "round")).toHaveLength(1)
    expect(graph.nodes.some((node) => node.id === "message-restart")).toBe(false)
    expect(graph.nodes.find((node) => node.kind === "round")?.agent?.messageIDs).toEqual([
      "message-assistant-before-restart",
      "message-assistant-after-restart",
    ])
  }),
)

it.effect("keeps commentary, reasoning, and response inside the round exactly once", () =>
  Effect.sync(() => {
    const graph = projectMessages(effectSessionMessages())
    const narratives = graph.nodes.find((node) => node.kind === "round")?.agent?.narratives

    expect(narratives?.map((item) => item.kind)).toEqual(["commentary", "reasoning", "response"])
    expect(narratives?.map((item) => item.detail)).toEqual([
      "I’ll inspect the project.",
      "Check the package structure.",
      "This is an Effect project.",
    ])
  }),
)

it.effect("retains chronological round history with message-level provenance", () =>
  Effect.sync(() => {
    const graph = projectMessages(effectSessionMessages())
    const history = graph.nodes.find((node) => node.kind === "round")?.round?.history

    expect(history?.map((item) => item.kind)).toEqual([
      "user",
      "commentary",
      "tool",
      "tool",
      "tool",
      "tool",
      "tool",
      "tool",
      "tool",
      "tool",
      "reasoning",
      "tool",
      "tool",
      "response",
    ])
    expect(history?.[0]?.provenance.messageIDs).toEqual(["message-user"])
    expect(history?.at(-1)?.provenance.messageIDs).toEqual(["message-assistant-4"])
  }),
)

it.effect("keeps a stable round identity before assistant work arrives", () =>
  Effect.sync(() => {
    const pending = projectMessages([userMessage()])
    const completed = projectMessages([
      userMessage(),
      assistantMessage("message-assistant", [{ type: "text", text: "Done" }], 2_000),
    ])

    expect(pending.nodes[0]?.id).toBe("round:message-user")
    expect(completed.nodes[0]?.id).toBe("round:message-user")
    expect(pending.nodes[0]?.round?.agent).toBeUndefined()
    expect(completed.nodes[0]?.round?.agent?.messageIDs).toEqual(["message-assistant"])
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

    expect(graph.nodes.find((node) => node.kind === "round")?.round?.input?.text).toBe(markdown)
    expect(graph.nodes.find((node) => node.kind === "round")?.agent?.narratives[0]?.detail).toBe(
      markdown,
    )
  }),
)

it.effect("projects every tool call into one chronological round list", () =>
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
      ["tools", "round:message-user", "round:message-user:tools"],
    ])
    expect(
      graph.nodes
        .find((node) => node.kind === "round-tools")
        ?.roundTools?.calls.map((call) => call.name),
    ).toEqual(["read", "apply_patch", "grep", "shell"])
  }),
)

it.effect("keeps mixed read and write calls in the same round list", () =>
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
    const calls = graph.nodes.find((node) => node.kind === "round-tools")?.roundTools?.calls

    expect(calls?.map((call) => call.name)).toEqual(["read", "shell", "edit", "shell"])
    expect(calls?.every((call) => call.provenance.messageIDs[0] === "message-assistant")).toBe(true)
  }),
)

it.effect("keeps skill and apply_patch calls together in their original order", () =>
  Effect.sync(() => {
    const graph = projectMessages([
      assistantMessage(
        "message-assistant",
        [
          tool("call-skill", "skill", { name: "customize-opencode" }, 1_010),
          tool("call-patch", "apply_patch", { patchText: "*** Begin Patch" }, 1_020),
        ],
        1_000,
      ),
    ])
    expect(
      graph.nodes
        .find((node) => node.kind === "round-tools")
        ?.roundTools?.calls.map((call) => call.name),
    ).toEqual(["skill", "apply_patch"])
  }),
)

it.effect("classifies shell conservatively and defaults unknown tools to actions", () =>
  Effect.sync(() => {
    expect(classifyToolCall("task", { subagent_type: "explore" })).toBe("subagent")
    expect(classifyToolCall("subagent", { agent: "general" })).toBe("subagent")
    expect(classifyToolCall("webfetch", { url: "https://example.com" })).toBe("read")
    expect(classifyToolCall("skill", { name: "frontend-design" })).toBe("read")
    expect(classifyToolCall("shell", { command: "git status && rg TODO src" })).toBe("read")
    expect(classifyToolCall("shell", { command: "npm view effect version" })).toBe("read")
    expect(classifyToolCall("shell", { command: "npm install --help" })).toBe("read")
    expect(classifyToolCall("shell", { command: "some-command --help" })).toBe("read")
    expect(classifyToolCall("shell", { command: "some-command --help && touch output" })).toBe(
      "write",
    )
    expect(classifyToolCall("shell", { command: "rg TODO src > todos.txt" })).toBe("write")
    expect(classifyToolCall("shell", { command: "bun test" })).toBe("write")
    expect(classifyToolCall("apply_patch", { patchText: "*** Begin Patch" })).toBe("write")
    expect(classifyToolCall("custom-tool", {})).toBe("write")
  }),
)

it.effect("retains subagent session IDs on the unified tool list", () =>
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
    const tools = graph.nodes.find((node) => node.kind === "round-tools")

    expect(tools?.roundTools?.calls[0]?.subagentSessionID).toBe("session-child")
    expect(graph.edges).toContainEqual({
      id: "round:message-assistant-task->round:message-assistant-task:tools",
      source: "round:message-assistant-task",
      target: "round:message-assistant-task:tools",
      kind: "tools",
    })
  }),
)

it.effect("creates one stable tool list across assistant messages", () =>
  Effect.sync(() => {
    const first = projectMessages(effectSessionMessages())
    const second = projectMessages(effectSessionMessages())
    const tools = first.nodes.find((node) => node.kind === "round-tools")

    expect(tools?.id).toBe("round:message-user:tools")
    expect(tools?.roundTools?.calls).toHaveLength(10)
    expect(second.nodes.find((node) => node.kind === "round-tools")?.id).toBe(tools?.id)
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
    const call = graph.nodes.find((node) => node.kind === "round-tools")?.roundTools?.calls[0]
    const artifacts = graph.nodes.find((node) => node.kind === "round-artifacts")?.roundArtifacts

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
    expect(artifacts?.diff).toEqual(call?.diff)
    expect(graph.edges).toContainEqual({
      id: "round:message-assistant-patch->round:message-assistant-patch:artifacts",
      source: "round:message-assistant-patch",
      target: "round:message-assistant-patch:artifacts",
      kind: "artifacts",
    })
  }),
)

it.effect("retains unified tool provenance and timing", () =>
  Effect.sync(() => {
    const graph = projectMessages([
      assistantMessage(
        "message-assistant",
        [tool("call-read", "read", { filePath: "one.ts" }, 1_010)],
        1_000,
      ),
    ])
    const tools = graph.nodes.find((node) => node.kind === "round-tools")

    expect(tools?.provenance).toEqual({
      source: "derived",
      messageIDs: ["message-assistant"],
      contentIndexes: [0],
      toolCallIDs: ["call-read"],
    })
    expect(tools?.roundTools?.calls[0]?.time).toEqual({
      created: 1_010,
      started: 1_011,
      completed: 1_030,
    })
  }),
)

it.effect("draws direct spokes between source and target handles", () =>
  Effect.sync(() => {
    expect(
      spokePath({
        sourceX: 100,
        sourceY: 200,
        sourcePosition: "top",
        targetX: 40,
        targetY: 100,
        targetPosition: "bottom",
      }),
    ).toBe("M 100 200 L 40 100")
    expect(
      spokePath({
        sourceX: 100,
        sourceY: 200,
        sourcePosition: "right",
        targetX: 160,
        targetY: 300,
        targetPosition: "top",
      }),
    ).toBe("M 100 200 L 160 300")
    expect(
      spokePath({
        sourceX: 100,
        sourceY: 200,
        sourcePosition: "top",
        targetX: 100,
        targetY: 100,
        targetPosition: "bottom",
      }),
    ).toBe("M 100 200 L 100 100")
  }),
)
