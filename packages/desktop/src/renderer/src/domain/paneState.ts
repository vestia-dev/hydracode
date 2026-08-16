import type { PaneDirection, PaneSplitCommand } from "../../../shared/pane"
import type { PaneUIState, ProjectUIState } from "../../../shared/applicationState"
import {
  adjacentPaneID,
  closePane,
  firstPaneID,
  hasPane,
  initialPaneLayout,
  paneInDirection,
  restorePaneLayout,
  setSplitRatio,
  splitPane,
  type PaneLayout,
} from "./paneLayout"

export interface PaneState {
  readonly layout: PaneLayout
  readonly activePaneID: string
  readonly panes: ReadonlyMap<string, PaneUIState>
}

export type PaneStateAction =
  | {
      readonly _tag: "Split"
      readonly command: PaneSplitCommand
      readonly splitID: string
      readonly newPaneID: string
      readonly locationKey: string
    }
  | { readonly _tag: "Close" }
  | { readonly _tag: "Focus"; readonly paneID: string }
  | { readonly _tag: "FocusDirection"; readonly direction: PaneDirection }
  | { readonly _tag: "Resize"; readonly splitID: string; readonly ratio: number }
  | {
      readonly _tag: "UpdatePane"
      readonly paneID: string
      readonly update: Partial<Omit<PaneUIState, "paneID">>
    }

const defaultPane = (paneID: string): PaneUIState => ({
  paneID,
  followLatest: true,
  expandedRoundIDs: [],
  expandedSubagentIDs: [],
  draft: "",
})

export function createPaneState(
  initialPaneID: string,
  defaultLocationKey: string,
  saved: ProjectUIState | undefined,
): PaneState {
  const restoredLayout = saved === undefined ? undefined : restorePaneLayout(saved.layout)
  const layout = restoredLayout ?? initialPaneLayout(initialPaneID)
  const activePaneID =
    restoredLayout !== undefined && hasPane(restoredLayout, saved?.activePaneID ?? "")
      ? (saved?.activePaneID ?? firstPaneID(layout))
      : firstPaneID(layout)
  if (restoredLayout === undefined) return { layout, activePaneID, panes: new Map() }

  const savedNodes = new Map(saved?.layout.nodes.map((node) => [node.id, node]) ?? [])
  const savedPanes = new Map((saved?.panes ?? []).map((pane) => [pane.paneID, pane]))
  const panes = new Map<string, PaneUIState>()
  for (const node of savedNodes.values()) {
    if (node._tag !== "Pane") continue
    const pane = savedPanes.get(node.id) ?? defaultPane(node.id)
    if (pane.content !== undefined) {
      panes.set(pane.paneID, pane)
      continue
    }
    panes.set(pane.paneID, {
      ...pane,
      content:
        node.sessionID !== undefined
          ? { _tag: "Session", sessionID: node.sessionID }
          : {
              _tag: "NewSession",
              locationKey: node.locationKey ?? defaultLocationKey,
            },
    })
  }
  return { layout, activePaneID, panes }
}

export function reducePaneState(state: PaneState, action: PaneStateAction): PaneState {
  switch (action._tag) {
    case "Split": {
      const layout = splitPane(
        state.layout,
        state.activePaneID,
        action.command,
        action.splitID,
        action.newPaneID,
      )
      if (layout === state.layout) return state
      const panes = new Map(state.panes)
      panes.set(action.newPaneID, {
        ...defaultPane(action.newPaneID),
        content: { _tag: "NewSession", locationKey: action.locationKey },
      })
      return { layout, activePaneID: action.newPaneID, panes }
    }
    case "Close": {
      const layout = closePane(state.layout, state.activePaneID)
      if (layout === state.layout) return state
      const panes = new Map(state.panes)
      panes.delete(state.activePaneID)
      return {
        layout,
        activePaneID: adjacentPaneID(state.layout, state.activePaneID) ?? firstPaneID(layout),
        panes,
      }
    }
    case "Focus":
      return action.paneID === state.activePaneID || !hasPane(state.layout, action.paneID)
        ? state
        : { ...state, activePaneID: action.paneID }
    case "FocusDirection": {
      const paneID = paneInDirection(state.layout, state.activePaneID, action.direction)
      return paneID === undefined ? state : { ...state, activePaneID: paneID }
    }
    case "Resize": {
      const layout = setSplitRatio(state.layout, action.splitID, action.ratio)
      return layout === state.layout ? state : { ...state, layout }
    }
    case "UpdatePane": {
      const previous = state.panes.get(action.paneID) ?? defaultPane(action.paneID)
      const panes = new Map(state.panes)
      panes.set(action.paneID, { ...previous, ...action.update })
      return { ...state, panes }
    }
  }
  return state
}
