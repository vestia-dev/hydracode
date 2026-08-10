import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  adjacentPaneID,
  closePane,
  initialPaneLayout,
  setPaneSession,
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

it.effect("updates pane selection and clamps divider ratios", () =>
  Effect.sync(() => {
    const split = splitPane(initialPaneLayout("one"), "one", "right", "split", "two")
    expect(setPaneSession(split, "two", "session-2")).toMatchObject({
      second: { sessionID: "session-2" },
    })
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
