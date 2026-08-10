import type { PaneDirection, PaneSplitCommand } from "../../../shared/pane"
import type { SavedPaneLayout, SavedPaneNode } from "../../../shared/layout"

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

export function savePaneLayout(layout: PaneLayout): SavedPaneLayout {
  const nodes: SavedPaneNode[] = []
  const visit = (node: PaneLayout) => {
    if (node._tag === "Pane") {
      nodes.push(
        node.sessionID === undefined
          ? { _tag: "Pane", id: node.id }
          : { _tag: "Pane", id: node.id, sessionID: node.sessionID },
      )
      return
    }
    nodes.push({
      _tag: "Split",
      id: node.id,
      direction: node.direction,
      ratio: node.ratio,
      first: node.first.id,
      second: node.second.id,
    })
    visit(node.first)
    visit(node.second)
  }
  visit(layout)
  return { rootID: layout.id, nodes }
}

export function restorePaneLayout(saved: SavedPaneLayout): PaneLayout | undefined {
  const nodes = new Map(saved.nodes.map((node) => [node.id, node]))
  if (nodes.size !== saved.nodes.length) return undefined
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): PaneLayout | undefined => {
    if (visiting.has(id)) return undefined
    const node = nodes.get(id)
    if (node === undefined) return undefined
    visiting.add(id)
    if (node._tag === "Pane") {
      visiting.delete(id)
      visited.add(id)
      return node.sessionID === undefined
        ? { _tag: "Pane", id: node.id }
        : { _tag: "Pane", id: node.id, sessionID: node.sessionID }
    }
    if (!Number.isFinite(node.ratio) || node.ratio < 0.15 || node.ratio > 0.85) return undefined
    const first = visit(node.first)
    const second = visit(node.second)
    visiting.delete(id)
    if (first === undefined || second === undefined) return undefined
    visited.add(id)
    return {
      _tag: "Split",
      id: node.id,
      direction: node.direction,
      ratio: node.ratio,
      first,
      second,
    }
  }
  const layout = visit(saved.rootID)
  return layout !== undefined && visited.size === nodes.size ? layout : undefined
}

export function paneSessionIDs(layout: PaneLayout): ReadonlyArray<string> {
  if (layout._tag === "Pane") return layout.sessionID === undefined ? [] : [layout.sessionID]
  return Array.from(new Set([...paneSessionIDs(layout.first), ...paneSessionIDs(layout.second)]))
}

export function paneCount(layout: PaneLayout): number {
  return layout._tag === "Pane" ? 1 : paneCount(layout.first) + paneCount(layout.second)
}

export function firstPaneID(layout: PaneLayout): string {
  return layout._tag === "Pane" ? layout.id : firstPaneID(layout.first)
}

interface PaneBounds {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function paneInDirection(
  layout: PaneLayout,
  paneID: string,
  direction: PaneDirection,
): string | undefined {
  const panes: PaneBounds[] = []
  const collect = (node: PaneLayout, x: number, y: number, width: number, height: number) => {
    if (node._tag === "Pane") {
      panes.push({ id: node.id, x, y, width, height })
      return
    }
    if (node.direction === "horizontal") {
      const firstWidth = width * node.ratio
      collect(node.first, x, y, firstWidth, height)
      collect(node.second, x + firstWidth, y, width - firstWidth, height)
    } else {
      const firstHeight = height * node.ratio
      collect(node.first, x, y, width, firstHeight)
      collect(node.second, x, y + firstHeight, width, height - firstHeight)
    }
  }
  collect(layout, 0, 0, 1, 1)
  const source = panes.find((pane) => pane.id === paneID)
  if (source === undefined) return undefined

  const horizontal = direction === "left" || direction === "right"
  const sourceStart = horizontal ? source.y : source.x
  const sourceEnd = sourceStart + (horizontal ? source.height : source.width)
  const sourceCenter = (sourceStart + sourceEnd) / 2
  const epsilon = 1e-9
  return panes
    .filter((pane) => {
      if (pane.id === paneID) return false
      if (direction === "left") return pane.x + pane.width <= source.x + epsilon
      if (direction === "right") return pane.x >= source.x + source.width - epsilon
      if (direction === "up") return pane.y + pane.height <= source.y + epsilon
      return pane.y >= source.y + source.height - epsilon
    })
    .map((pane) => {
      const start = horizontal ? pane.y : pane.x
      const end = start + (horizontal ? pane.height : pane.width)
      const perpendicularGap = Math.max(0, sourceStart - end, start - sourceEnd)
      const primaryGap =
        direction === "left"
          ? source.x - (pane.x + pane.width)
          : direction === "right"
            ? pane.x - (source.x + source.width)
            : direction === "up"
              ? source.y - (pane.y + pane.height)
              : pane.y - (source.y + source.height)
      return {
        id: pane.id,
        perpendicularGap,
        primaryGap,
        centerDistance: Math.abs((start + end) / 2 - sourceCenter),
      }
    })
    .toSorted(
      (left, right) =>
        left.perpendicularGap - right.perpendicularGap ||
        left.primaryGap - right.primaryGap ||
        left.centerDistance - right.centerDistance,
    )[0]?.id
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
