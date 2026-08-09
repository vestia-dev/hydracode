import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { activateNewBranches, toggleBranchVisibility } from "./branchVisibility"

it.effect("collapses a visible branch without changing its siblings", () =>
  Effect.sync(() => {
    expect(toggleBranchVisibility(new Set(), "read-1", ["read-1", "task-1"])).toEqual(
      new Set(["read-1"]),
    )
  }),
)

it.effect("opens a branch exclusively within its timeline side", () =>
  Effect.sync(() => {
    expect(
      toggleBranchVisibility(new Set(["read-1", "task-1", "write-1"]), "task-1", [
        "read-1",
        "task-1",
      ]),
    ).toEqual(new Set(["read-1", "write-1"]))
  }),
)

it.effect("activates the newest branch and hides older branches on the same side", () =>
  Effect.sync(() => {
    expect(
      activateNewBranches(new Set(["write-1"]), new Set(["read-1", "task-1", "write-1"]), [
        ["read-1", "task-1", "read-2"],
        ["write-1"],
      ]),
    ).toEqual(new Set(["read-1", "task-1", "write-1"]))
  }),
)
