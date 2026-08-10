import { Schema } from "effect"
import { Project } from "@opencode-ai/client/effect"

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

export const SavedLayout = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  created: Schema.Number,
  updated: Schema.Number,
  layout: SavedPaneLayout,
})
export type SavedLayout = typeof SavedLayout.Type

export const SavedProjectLayouts = Schema.Struct({
  projectID: Project.ID,
  layouts: Schema.Array(SavedLayout),
})
export type SavedProjectLayouts = typeof SavedProjectLayouts.Type

export const SavedLayoutsFile = Schema.Array(SavedProjectLayouts)
export type SavedLayoutsFile = typeof SavedLayoutsFile.Type

export const ListSavedLayoutsCommand = Schema.Struct({ projectID: Project.ID })
export type ListSavedLayoutsCommand = typeof ListSavedLayoutsCommand.Type

export const SaveLayoutCommand = Schema.Struct({
  projectID: Project.ID,
  layoutID: Schema.optional(Schema.String),
  name: Schema.String,
  layout: SavedPaneLayout,
})
export type SaveLayoutCommand = typeof SaveLayoutCommand.Type

export const ListSavedLayoutsResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), layouts: Schema.Array(SavedLayout) }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type ListSavedLayoutsResult = typeof ListSavedLayoutsResult.Type

export const SaveLayoutResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), layout: SavedLayout }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type SaveLayoutResult = typeof SaveLayoutResult.Type
