import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { CommandMenuDefinitions, filterCommandMenuDefinitions } from "./commandMenu"

it.effect("lists every current application command once", () =>
  Effect.sync(() => {
    expect(CommandMenuDefinitions.map(({ id }) => id)).toEqual([
      "new-session",
      "open-project",
      "save-prompt",
      "view-saved-prompts",
      "toggle-settings",
      "split-pane-right",
      "split-pane-down",
      "split-pane-left",
      "split-pane-up",
      "focus-pane-left",
      "focus-pane-down",
      "focus-pane-up",
      "focus-pane-right",
      "focus-prompt",
      "follow-latest-node",
      "close-pane",
    ])
    expect(new Set(CommandMenuDefinitions.map(({ id }) => id)).size).toBe(
      CommandMenuDefinitions.length,
    )
  }),
)

it.effect("searches command titles, categories, and aliases across multiple terms", () =>
  Effect.sync(() => {
    expect(filterCommandMenuDefinitions("split left").map(({ id }) => id)).toEqual([
      "split-pane-left",
    ])
    expect(filterCommandMenuDefinitions("graph focus").map(({ id }) => id)).toEqual([
      "follow-latest-node",
    ])
    expect(filterCommandMenuDefinitions("appearance").map(({ id }) => id)).toEqual([
      "toggle-settings",
    ])
    expect(filterCommandMenuDefinitions("clipboard").map(({ id }) => id)).toEqual([
      "view-saved-prompts",
    ])
    expect(filterCommandMenuDefinitions("  ")).toBe(CommandMenuDefinitions)
  }),
)
