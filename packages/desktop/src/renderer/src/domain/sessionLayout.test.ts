import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  collapsedSubagentPosition,
  horizontalRoundSideNodePosition,
  roundSideNodePosition,
  roundBranchWidth,
  roundTimelineDistance,
  splitRoundToolsX,
  splitRoundToolsWidth,
  splitRoundSideNodeX,
  subagentTimelinePosition,
  timelinePositions,
} from "./sessionLayout"

const distance = { horizontal: 32, vertical: 24 }

it.effect("uses horizontal distance as the edge-to-edge timeline gap", () =>
  Effect.sync(() => {
    expect(timelinePositions([220, 300, 270], distance)).toEqual([
      { x: 0, y: 480 },
      { x: 252, y: 480 },
      { x: 584, y: 480 },
    ])
  }),
)

it.effect("increases round timeline spacing by fifty percent", () =>
  Effect.sync(() => {
    expect(roundTimelineDistance(distance)).toEqual({ horizontal: 48, vertical: 24 })
  }),
)

it.effect("aligns round side nodes directly above and below the round", () =>
  Effect.sync(() => {
    const roundPosition = { x: 300, y: 480 }
    const roundSize = { width: 420, height: 120 }

    expect(roundSideNodePosition(roundPosition, roundSize, 240, 24, "top")).toEqual({
      x: 300,
      y: 216,
    })
    expect(roundSideNodePosition(roundPosition, roundSize, 360, 24, "bottom")).toEqual({
      x: 300,
      y: 624,
    })
  }),
)

it.effect("places subagent tools left and outputs right of their round", () =>
  Effect.sync(() => {
    const roundPosition = { x: 300, y: 480 }
    const roundSize = { width: 420, height: 120 }

    expect(
      horizontalRoundSideNodePosition(
        roundPosition,
        roundSize,
        { width: 240, height: 180 },
        32,
        "left",
      ),
    ).toEqual({ x: 28, y: 480 })
    expect(
      horizontalRoundSideNodePosition(
        roundPosition,
        roundSize,
        { width: 420, height: 300 },
        32,
        "right",
      ),
    ).toEqual({ x: 752, y: 480 })
  }),
)

it.effect("uses the left half of a round for tools when a subagent occupies the right lane", () =>
  Effect.sync(() => {
    const toolsWidth = splitRoundToolsWidth(420, 32)
    expect(toolsWidth).toBe(194)
    expect(splitRoundToolsX({ x: 300, y: 480 }, 420, toolsWidth)).toBe(308)
  }),
)

it.effect("divides branch width equally among only the nodes that exist", () =>
  Effect.sync(() => {
    expect(roundBranchWidth(420, 32, 1)).toBe(420)
    expect(roundBranchWidth(420, 32, 2)).toBe(194)
    expect(roundBranchWidth(420, 32, 3)).toBeCloseTo(118.67, 2)
  }),
)

it.effect("places paired lower nodes in left and right lanes", () =>
  Effect.sync(() => {
    const width = splitRoundToolsWidth(420, 32)
    expect(splitRoundSideNodeX({ x: 300, y: 480 }, 420, width, "left")).toBe(308)
    expect(splitRoundSideNodeX({ x: 300, y: 480 }, 420, width, "right")).toBe(518)
  }),
)

it.effect("places a content-sized collapsed subagent beside tools", () =>
  Effect.sync(() => {
    const toolsWidth = splitRoundToolsWidth(420, 32)
    expect(
      collapsedSubagentPosition(
        { x: 300, y: 480 },
        420,
        { x: 308, y: 240 },
        { width: toolsWidth, height: 96 },
        { width: toolsWidth, height: 66 },
      ),
    ).toEqual({ x: 518, y: 270 })
  }),
)

it.effect("places subagent timelines in a right-hand lane above their originating round", () =>
  Effect.sync(() => {
    expect(
      subagentTimelinePosition(
        { x: 300, y: 480 },
        { width: 420, height: 120 },
        { x: 300, y: 240 },
        { width: 220, height: 200 },
        [],
        distance,
      ),
    ).toEqual({ x: 505, y: 16 })
    expect(
      subagentTimelinePosition(
        { x: 300, y: 480 },
        { width: 420, height: 120 },
        { x: 300, y: 240 },
        { width: 220, height: 120 },
        [200],
        distance,
      ),
    ).toEqual({ x: 505, y: -128 })
  }),
)
