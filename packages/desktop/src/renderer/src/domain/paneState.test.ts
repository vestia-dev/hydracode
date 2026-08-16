import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Project } from "@opencode-ai/client/effect"
import { createPaneState, reducePaneState } from "./paneState"

it.effect("updates layout, focus, and content together when splitting and closing", () =>
  Effect.sync(() => {
    const initial = createPaneState("one", "project-a", undefined)
    const split = reducePaneState(initial, {
      _tag: "Split",
      command: "right",
      splitID: "split",
      newPaneID: "two",
      locationKey: "project-a",
    })

    expect(split.layout).toMatchObject({
      _tag: "Split",
      first: { id: "one" },
      second: { id: "two" },
    })
    expect(split.activePaneID).toBe("two")
    expect(split.panes.get("two")?.content).toEqual({
      _tag: "NewSession",
      locationKey: "project-a",
    })

    const closed = reducePaneState(split, { _tag: "Close" })
    expect(closed.layout).toEqual({ _tag: "Pane", id: "one" })
    expect(closed.activePaneID).toBe("one")
    expect(closed.panes.has("two")).toBe(false)
  }),
)

it.effect("ignores focus requests for panes that are not in the layout", () =>
  Effect.sync(() => {
    const initial = createPaneState("one", "project-a", undefined)
    expect(reducePaneState(initial, { _tag: "Focus", paneID: "missing" })).toBe(initial)
  }),
)

it.effect("restores legacy pane content into the combined state", () =>
  Effect.sync(() => {
    const restored = createPaneState("new", "project-a", {
      locationKey: "project-a",
      projectID: Project.ID.make("project-id"),
      activePaneID: "one",
      layout: {
        rootID: "one",
        nodes: [{ _tag: "Pane", id: "one", sessionID: "session-one" }],
      },
      panes: [],
      updated: 1,
    })

    expect(restored.activePaneID).toBe("one")
    expect(restored.panes.get("one")?.content).toEqual({
      _tag: "Session",
      sessionID: "session-one",
    })
  }),
)
