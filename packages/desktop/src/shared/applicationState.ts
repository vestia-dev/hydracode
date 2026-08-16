import { Location, Project } from "@opencode-ai/client/effect"
import { Schema } from "effect"
import { SavedPaneLayout } from "./layout"

export const ProjectSelectionState = Schema.Struct({
  openLocations: Schema.Array(Schema.Struct({ projectID: Project.ID, location: Location.Ref })),
  activeLocationKey: Schema.Union([Schema.String, Schema.Null]),
})
export type ProjectSelectionState = typeof ProjectSelectionState.Type

export const PaneViewport = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  zoom: Schema.Number,
})
export type PaneViewport = typeof PaneViewport.Type

export const PaneContent = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Session"), sessionID: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("NewSession"), locationKey: Schema.String }),
])
export type PaneContent = typeof PaneContent.Type

export const PaneUIState = Schema.Struct({
  paneID: Schema.String,
  content: Schema.optional(PaneContent),
  viewport: Schema.optional(PaneViewport),
  followLatest: Schema.Boolean,
  expandedRoundIDs: Schema.Array(Schema.String),
  expandedSubagentIDs: Schema.Array(Schema.String),
  draft: Schema.String,
})
export type PaneUIState = typeof PaneUIState.Type

export const ProjectUIState = Schema.Struct({
  locationKey: Schema.String,
  projectID: Project.ID,
  activePaneID: Schema.String,
  layout: SavedPaneLayout,
  panes: Schema.Array(PaneUIState),
  updated: Schema.Number,
})
export type ProjectUIState = typeof ProjectUIState.Type

export const ApplicationState = Schema.Struct({
  version: Schema.Literal(2),
  openLocations: Schema.Array(Schema.Struct({ projectID: Project.ID, location: Location.Ref })),
  activeLocationKey: Schema.Union([Schema.String, Schema.Null]),
  projects: Schema.Array(ProjectUIState),
})
export type ApplicationState = typeof ApplicationState.Type

export const ApplicationStateV1 = Schema.Struct({
  version: Schema.Literal(1),
  openProjectIDs: Schema.Array(Project.ID),
  activeProjectID: Schema.Union([Project.ID, Schema.Null]),
  projects: Schema.Array(
    Schema.Struct({
      projectID: Project.ID,
      activePaneID: Schema.String,
      layout: SavedPaneLayout,
      panes: Schema.Array(PaneUIState),
      updated: Schema.Number,
    }),
  ),
})
export type ApplicationStateV1 = typeof ApplicationStateV1.Type

export const ApplicationStateLoad = Schema.Union([ApplicationState, ApplicationStateV1])
export type ApplicationStateLoad = typeof ApplicationStateLoad.Type

export const ApplicationStateResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Success"),
    state: ApplicationStateLoad,
  }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type ApplicationStateResult = typeof ApplicationStateResult.Type

export const ProjectUIStateResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), state: ProjectUIState }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type ProjectUIStateResult = typeof ProjectUIStateResult.Type
