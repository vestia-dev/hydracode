import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  adjacentPaneID,
  closePane,
  hasPane,
  initialPaneLayout,
  paneInDirection,
  restorePaneLayout,
  savePaneLayout,
  setSplitRatio,
  splitPane,
} from "./paneLayout"

it.effect("splits after the active pane to the right and down", () =>
  Effect.sync(() => {
    const right = splitPane(initialPaneLayout("one"), "one", "right", "split-a", "two")
    expect(right).toMatchObject({
      direction: "horizontal",
      first: { id: "one" },
      second: { id: "two" },
    })
    const down = splitPane(right, "two", "down", "split-b", "three")
    expect(down).toMatchObject({
      second: {
        direction: "vertical",
        first: { id: "two" },
        second: { id: "three" },
      },
    })
  }),
)

it.effect("serializes and restores split dimensions", () =>
  Effect.sync(() => {
    const split = setSplitRatio(
      splitPane(initialPaneLayout("one"), "one", "right", "split", "two"),
      "split",
      0.7,
    )
    const saved = savePaneLayout(split)

    expect(restorePaneLayout(saved)).toEqual(split)
  }),
)

it.effect("keeps pane layout independent from legacy persisted content", () =>
  Effect.sync(() => {
    expect(
      restorePaneLayout({
        rootID: "one",
        nodes: [
          {
            _tag: "Pane",
            id: "one",
            sessionID: "legacy-session",
            locationKey: "/code/worktree\u0000",
          },
        ],
      }),
    ).toEqual(initialPaneLayout("one"))
  }),
)

it.effect("rejects malformed persisted pane graphs", () =>
  Effect.sync(() => {
    expect(
      restorePaneLayout({
        rootID: "split",
        nodes: [
          {
            _tag: "Split",
            id: "split",
            direction: "horizontal",
            ratio: 0.5,
            first: "split",
            second: "missing",
          },
        ],
      }),
    ).toBeUndefined()
  }),
)

it.effect("finds the nearest pane in each geometric direction", () =>
  Effect.sync(() => {
    const right = splitPane(initialPaneLayout("left"), "left", "right", "split-a", "top-right")
    const layout = splitPane(right, "top-right", "down", "split-b", "bottom-right")

    expect(paneInDirection(layout, "left", "right")).toBe("top-right")
    expect(paneInDirection(layout, "top-right", "down")).toBe("bottom-right")
    expect(paneInDirection(layout, "bottom-right", "up")).toBe("top-right")
    expect(paneInDirection(layout, "bottom-right", "left")).toBe("left")
    expect(paneInDirection(layout, "left", "left")).toBeUndefined()
    expect(paneInDirection(layout, "missing", "right")).toBeUndefined()
  }),
)

it.effect("places left and up splits before the active pane", () =>
  Effect.sync(() => {
    expect(splitPane(initialPaneLayout("one"), "one", "left", "split", "two")).toMatchObject({
      direction: "horizontal",
      first: { id: "two" },
      second: { id: "one" },
    })
    expect(splitPane(initialPaneLayout("one"), "one", "up", "split", "two")).toMatchObject({
      direction: "vertical",
      first: { id: "two" },
      second: { id: "one" },
    })
  }),
)

it.effect("clamps divider ratios", () =>
  Effect.sync(() => {
    const split = splitPane(initialPaneLayout("one"), "one", "right", "split", "two")
    expect(setSplitRatio(split, "split", 2)).toMatchObject({ ratio: 0.85 })
    expect(setSplitRatio(split, "split", -1)).toMatchObject({ ratio: 0.15 })
  }),
)

it.effect("closes a pane, collapses its split, and identifies the adjacent pane", () =>
  Effect.sync(() => {
    const right = splitPane(initialPaneLayout("one"), "one", "right", "split-a", "two")
    const nested = splitPane(right, "two", "down", "split-b", "three")
    expect(adjacentPaneID(nested, "three")).toBe("two")
    expect(closePane(nested, "three")).toEqual(right)
    expect(closePane(initialPaneLayout("one"), "one")).toEqual(initialPaneLayout("one"))
  }),
)

it.effect("validates the active pane", () =>
  Effect.sync(() => {
    const split = splitPane(initialPaneLayout("one"), "one", "right", "split", "two")
    expect(hasPane(split, "two")).toBe(true)
    expect(hasPane(split, "missing")).toBe(false)
  }),
)
