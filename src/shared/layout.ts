import { Schema } from "effect"

export const SavedPaneNode = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Pane"),
    id: Schema.String,
    sessionID: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Split"),
    id: Schema.String,
    direction: Schema.Union([Schema.Literal("horizontal"), Schema.Literal("vertical")]),
    ratio: Schema.Number,
    first: Schema.String,
    second: Schema.String,
  }),
])
export type SavedPaneNode = typeof SavedPaneNode.Type

export const SavedPaneLayout = Schema.Struct({
  rootID: Schema.String,
  nodes: Schema.Array(SavedPaneNode),
})
export type SavedPaneLayout = typeof SavedPaneLayout.Type
