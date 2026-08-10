import { Schema } from "effect"

export const PaneDirection = Schema.Union([
  Schema.Literal("right"),
  Schema.Literal("down"),
  Schema.Literal("left"),
  Schema.Literal("up"),
])
export type PaneDirection = typeof PaneDirection.Type

export const PaneSplitCommand = PaneDirection
export type PaneSplitCommand = typeof PaneSplitCommand.Type
