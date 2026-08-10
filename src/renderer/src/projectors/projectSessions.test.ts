import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  groupSessionFamilies,
  matchSubagentLaunchers,
  visibleSessionFamily,
} from "./projectSessions"

const sessions = [
  { id: "other" },
  { id: "grandchild", parentID: "child" },
  { id: "child", parentID: "root" },
  { id: "root" },
]

it.effect("keeps an active subagent with its root session family", () =>
  Effect.sync(() => {
    expect(visibleSessionFamily(sessions, new Set(["grandchild"]))).toEqual([
      { id: "grandchild", parentID: "child" },
      { id: "child", parentID: "root" },
      { id: "root" },
    ])
  }),
)

it.effect("groups descendants under their root regardless of list order", () =>
  Effect.sync(() => {
    expect(groupSessionFamilies(sessions)).toEqual([
      { root: { id: "other" }, descendants: [] },
      {
        root: { id: "root" },
        descendants: [
          { id: "grandchild", parentID: "child" },
          { id: "child", parentID: "root" },
        ],
      },
    ])
  }),
)

it.effect(
  "matches stored children to the nearest originating launcher when metadata is absent",
  () =>
    Effect.sync(() => {
      const matches = matchSubagentLaunchers(
        [
          { id: "child-late", created: 9_010 },
          { id: "child-early", created: 2_010 },
        ],
        [
          { id: "launcher-early", created: 2_000, sessionIDs: [] },
          { id: "launcher-late", created: 9_000, sessionIDs: [] },
        ],
      )

      expect(Object.fromEntries(matches)).toEqual({
        "child-early": "launcher-early",
        "child-late": "launcher-late",
      })
    }),
)

it.effect("does not guess an origin when no launcher predates the child", () =>
  Effect.sync(() => {
    const matches = matchSubagentLaunchers(
      [{ id: "child", created: 2_000 }],
      [{ id: "future-launcher", created: 3_000, sessionIDs: [] }],
    )

    expect(matches.size).toBe(0)
  }),
)
