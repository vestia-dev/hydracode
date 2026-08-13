import { Project } from "@opencode-ai/client/effect"
import { Schema } from "effect"
import { SavedPaneLayout } from "./layout"

export const ProjectSelectionState = Schema.Struct({
  openProjectIDs: Schema.Array(Project.ID),
  activeProjectID: Schema.Union([Project.ID, Schema.Null]),
})
export type ProjectSelectionState = typeof ProjectSelectionState.Type

export const PaneViewport = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  zoom: Schema.Number,
})
export type PaneViewport = typeof PaneViewport.Type

export const PaneUIState = Schema.Struct({
  paneID: Schema.String,
  viewport: Schema.optional(PaneViewport),
  followLatest: Schema.Boolean,
  expandedRoundIDs: Schema.Array(Schema.String),
  expandedSubagentIDs: Schema.Array(Schema.String),
  draft: Schema.String,
})
export type PaneUIState = typeof PaneUIState.Type

export const ProjectUIState = Schema.Struct({
  projectID: Project.ID,
  activePaneID: Schema.String,
  layout: SavedPaneLayout,
  panes: Schema.Array(PaneUIState),
  updated: Schema.Number,
})
export type ProjectUIState = typeof ProjectUIState.Type

export const ApplicationState = Schema.Struct({
  version: Schema.Literal(1),
  openProjectIDs: Schema.Array(Project.ID),
  activeProjectID: Schema.Union([Project.ID, Schema.Null]),
  projects: Schema.Array(ProjectUIState),
})
export type ApplicationState = typeof ApplicationState.Type

export const ApplicationStateResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Success"),
    state: ApplicationState,
  }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type ApplicationStateResult = typeof ApplicationStateResult.Type

export const ProjectUIStateResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), state: ProjectUIState }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type ProjectUIStateResult = typeof ProjectUIStateResult.Type
