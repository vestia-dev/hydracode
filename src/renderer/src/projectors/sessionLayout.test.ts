import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  readBranchPositions,
  subagentTimelinePosition,
  timelinePositions,
  writeBranchPositions,
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

it.effect("uses horizontal and vertical distances for branches", () =>
  Effect.sync(() => {
    const anchor = { x: 100, y: 480 }
    const sizes = [
      { width: 100, height: 60 },
      { width: 120, height: 80 },
    ]

    expect(readBranchPositions(anchor, 300, sizes, distance)).toEqual([
      { x: 124, y: 376 },
      { x: 256, y: 376 },
    ])
    expect(writeBranchPositions(anchor, 300, 96, sizes, distance)).toEqual([
      { x: 124, y: 600 },
      { x: 256, y: 600 },
    ])
  }),
)

it.effect("places subagent timelines in compact lanes above their originating agent", () =>
  Effect.sync(() => {
    expect(subagentTimelinePosition({ x: 300, y: 480 }, 420, 220, 200, [], distance)).toEqual({
      x: 400,
      y: 232,
    })
    expect(subagentTimelinePosition({ x: 300, y: 480 }, 420, 220, 120, [200], distance)).toEqual({
      x: 400,
      y: 64,
    })
    expect(
      subagentTimelinePosition({ x: 300, y: 480 }, 420, 220, 160, [200, 120], distance),
    ).toEqual({ x: 400, y: -144 })
  }),
)
