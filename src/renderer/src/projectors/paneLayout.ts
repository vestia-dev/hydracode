import type { PaneSplitCommand } from "../../../shared/pane"

export interface PaneLeaf {
  readonly _tag: "Pane"
  readonly id: string
  readonly sessionID?: string
}

export interface PaneSplit {
  readonly _tag: "Split"
  readonly id: string
  readonly direction: "horizontal" | "vertical"
  readonly ratio: number
  readonly first: PaneLayout
  readonly second: PaneLayout
}

export type PaneLayout = PaneLeaf | PaneSplit

export const initialPaneLayout = (id: string): PaneLayout => ({ _tag: "Pane", id })

export function firstPaneID(layout: PaneLayout): string {
  return layout._tag === "Pane" ? layout.id : firstPaneID(layout.first)
}

export function adjacentPaneID(layout: PaneLayout, paneID: string): string | undefined {
  if (layout._tag === "Pane") return undefined
  if (layout.first._tag === "Pane" && layout.first.id === paneID) return firstPaneID(layout.second)
  if (layout.second._tag === "Pane" && layout.second.id === paneID) return firstPaneID(layout.first)
  return adjacentPaneID(layout.first, paneID) ?? adjacentPaneID(layout.second, paneID)
}

export function closePane(layout: PaneLayout, paneID: string): PaneLayout {
  if (layout._tag === "Pane") return layout
  if (layout.first._tag === "Pane" && layout.first.id === paneID) return layout.second
  if (layout.second._tag === "Pane" && layout.second.id === paneID) return layout.first
  const first = closePane(layout.first, paneID)
  if (first !== layout.first) return { ...layout, first }
  const second = closePane(layout.second, paneID)
  return second === layout.second ? layout : { ...layout, second }
}

export function splitPane(
  layout: PaneLayout,
  paneID: string,
  command: PaneSplitCommand,
  splitID: string,
  newPaneID: string,
): PaneLayout {
  if (layout._tag === "Pane") {
    if (layout.id !== paneID) return layout
    const newPane: PaneLeaf = { _tag: "Pane", id: newPaneID }
    const before = command === "left" || command === "up"
    return {
      _tag: "Split",
      id: splitID,
      direction: command === "left" || command === "right" ? "horizontal" : "vertical",
      ratio: 0.5,
      first: before ? newPane : layout,
      second: before ? layout : newPane,
    }
  }
  const first = splitPane(layout.first, paneID, command, splitID, newPaneID)
  if (first !== layout.first) return { ...layout, first }
  const second = splitPane(layout.second, paneID, command, splitID, newPaneID)
  return second === layout.second ? layout : { ...layout, second }
}

export function setPaneSession(
  layout: PaneLayout,
  paneID: string,
  sessionID: string | undefined,
): PaneLayout {
  if (layout._tag === "Pane") {
    if (layout.id !== paneID) return layout
    return sessionID === undefined ? { _tag: "Pane", id: layout.id } : { ...layout, sessionID }
  }
  const first = setPaneSession(layout.first, paneID, sessionID)
  const second = setPaneSession(layout.second, paneID, sessionID)
  return first === layout.first && second === layout.second ? layout : { ...layout, first, second }
}

export function setSplitRatio(layout: PaneLayout, splitID: string, ratio: number): PaneLayout {
  if (layout._tag === "Pane") return layout
  if (layout.id === splitID) return { ...layout, ratio: Math.min(0.85, Math.max(0.15, ratio)) }
  const first = setSplitRatio(layout.first, splitID, ratio)
  const second = setSplitRatio(layout.second, splitID, ratio)
  return first === layout.first && second === layout.second ? layout : { ...layout, first, second }
}
