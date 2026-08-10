import { useEffect, useRef, type WheelEvent } from "react"
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react"
import type { GraphRoundArtifacts } from "../domain/graph"
import { ToolPatchDiff } from "./ToolPatchDiff"

export interface SessionRoundArtifactsNodeData extends Record<string, unknown> {
  readonly id: string
  readonly maxHeight?: number
  readonly width: number
  readonly artifacts: GraphRoundArtifacts
  readonly targetSide: "left" | "top"
  readonly reportSize: (id: string, width: number, height: number) => void
}

export type SessionRoundArtifactsFlowNode = Node<
  SessionRoundArtifactsNodeData,
  "sessionRoundArtifacts"
>

function scrollDiff(event: WheelEvent<HTMLDivElement>) {
  if (event.ctrlKey) return
  const element = event.currentTarget
  const previous = element.scrollTop
  element.scrollTop += event.deltaY
  if (element.scrollTop === previous) return
  event.preventDefault()
  event.stopPropagation()
}

export function SessionRoundArtifactsNode({ data }: NodeProps<SessionRoundArtifactsFlowNode>) {
  const nodeRef = useRef<HTMLElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()
  const additions = data.artifacts.diff.files.reduce((total, file) => total + file.additions, 0)
  const deletions = data.artifacts.diff.files.reduce((total, file) => total + file.deletions, 0)
  useEffect(() => {
    const element = nodeRef.current
    if (element === null) return undefined
    const reportSize = () => {
      data.reportSize(data.id, element.offsetWidth, element.offsetHeight)
      updateNodeInternals(data.id)
    }
    reportSize()
    const observer = new ResizeObserver(reportSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [data.id, data.reportSize, data.targetSide, data.width, updateNodeInternals])

  return (
    <article
      ref={nodeRef}
      className="round-artifacts-node"
      style={{
        width: data.width,
        ...(data.maxHeight === undefined ? {} : { maxHeight: data.maxHeight }),
      }}
    >
      <Handle
        id="artifacts-target"
        type="target"
        position={data.targetSide === "left" ? Position.Left : Position.Top}
        style={data.targetSide === "left" ? { top: "50%" } : undefined}
      />
      <header className="round-side-node__heading">
        <strong>Changes</strong>
        <span>
          {data.artifacts.diff.files.length} files · +{additions} -{deletions}
        </span>
      </header>
      <div className="round-artifacts-node__diff nowheel nodrag nopan" onWheelCapture={scrollDiff}>
        <ToolPatchDiff diff={data.artifacts.diff} open expandAll />
      </div>
    </article>
  )
}
