import { Schema } from "effect"

export const PaneSplitCommand = Schema.Union([
  Schema.Literal("right"),
  Schema.Literal("down"),
  Schema.Literal("left"),
  Schema.Literal("up"),
])
export type PaneSplitCommand = typeof PaneSplitCommand.Type
