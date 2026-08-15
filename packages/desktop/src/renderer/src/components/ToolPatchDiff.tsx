import { Component, useEffect, useMemo, useState, type ReactNode } from "react"
import { FileDiff, type FileDiffProps } from "@pierre/diffs/react"
import type { GraphToolDiff, GraphToolDiffFile } from "../domain/graph"
import { parsePierrePatch } from "../domain/pierrePatch"
import { useTheme } from "../theme"

function pierreOptions(
  themeType: "light" | "dark",
): NonNullable<FileDiffProps<undefined>["options"]> {
  return {
    themeType,
    overflow: "wrap",
    diffStyle: "unified",
    diffIndicators: "bars",
    disableFileHeader: true,
    hunkSeparators: "line-info-basic",
    lineDiffType: "none",
    unsafeCSS: `
    :host {
      --diffs-font-family: var(--typography-uiFontFamily);
      --diffs-font-size: 9px;
      --diffs-line-height: 18px;
      --diffs-bg: var(--diff-background);
      --diffs-light-bg: var(--diff-background);
      --diffs-dark-bg: var(--diff-background);
      --diffs-fg: var(--diff-foreground);
      --diffs-light: var(--diff-foreground);
      --diffs-dark: var(--diff-foreground);
      --diffs-fg-number-override: var(--diff-lineNumber);
      --diffs-bg-context-override: var(--diff-contextBackground);
      --diffs-bg-context-gutter-override: var(--diff-gutterBackground);
      --diffs-bg-separator-override: var(--diff-separatorBackground);
      --diffs-addition-base: var(--diff-addition);
      --diffs-addition-color-override: var(--diff-addition);
      --diffs-deletion-base: var(--diff-deletion);
      --diffs-deletion-color-override: var(--diff-deletion);
      --diffs-bg-addition-override: var(--diff-additionBackground);
      --diffs-bg-deletion-override: var(--diff-deletionBackground);
      --diffs-gap-block: 0;
      --diffs-gap-style: 0;
      --diffs-min-number-column-width: 3ch;
    }
  `,
  }
}

interface DiffBoundaryProps {
  readonly children: ReactNode
}

interface DiffBoundaryState {
  readonly failed: boolean
}

class DiffBoundary extends Component<DiffBoundaryProps, DiffBoundaryState> {
  override state: DiffBoundaryState = { failed: false }

  static getDerivedStateFromError(): DiffBoundaryState {
    return { failed: true }
  }

  override render() {
    return this.state.failed ? (
      <p className="tool-patch-diff__error">The stored patch could not be rendered.</p>
    ) : (
      this.props.children
    )
  }
}

function statusLabel(file: GraphToolDiffFile) {
  if (file.status === "added") return "Added"
  if (file.status === "deleted") return "Deleted"
  if (file.status === "moved") return "Moved"
  return "Modified"
}

interface PatchFileProps {
  readonly file: GraphToolDiffFile
  readonly open: boolean
  readonly toggle: () => void
}

function PatchFile({ file, open, toggle }: PatchFileProps) {
  const theme = useTheme()
  const [hasOpened, setHasOpened] = useState(open)
  const fileDiff = useMemo(() => parsePierrePatch(file.path, file.patch), [file.patch, file.path])
  const options = useMemo(
    () => pierreOptions(theme.diff?.themeType ?? "light"),
    [theme.diff?.themeType],
  )

  useEffect(() => {
    if (open) setHasOpened(true)
  }, [open])

  return (
    <li className="tool-patch-file">
      <button
        className="tool-patch-file__summary nodrag nopan"
        type="button"
        aria-expanded={open}
        onClick={toggle}
      >
        <span
          className={`tool-patch-file__chevron${open ? " tool-patch-file__chevron--expanded" : ""}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 10 10">
            <path d="m3 2 3 3-3 3" />
          </svg>
        </span>
        <strong>{file.path}</strong>
        <span className={`tool-patch-file__status tool-patch-file__status--${file.status}`}>
          {statusLabel(file)}
        </span>
        <span className="tool-patch-file__changes">
          <span>+{file.additions}</span> <span>-{file.deletions}</span>
        </span>
      </button>
      {hasOpened ? (
        <div className="tool-patch-file__diff nowheel nodrag nopan" hidden={!open}>
          {fileDiff === undefined ? (
            <p className="tool-patch-diff__error">The stored patch could not be rendered.</p>
          ) : (
            <DiffBoundary key={file.patch}>
              <FileDiff fileDiff={fileDiff} options={options} disableWorkerPool />
            </DiffBoundary>
          )}
        </div>
      ) : null}
    </li>
  )
}

interface ToolPatchDiffProps {
  readonly diff: GraphToolDiff
  readonly open: boolean
  readonly expandAll?: boolean
}

export function ToolPatchDiff({ diff, open, expandAll = false }: ToolPatchDiffProps) {
  const [hasOpened, setHasOpened] = useState(open)
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(() => {
    if (expandAll) return new Set(diff.files.map((file) => file.path))
    const firstVisible = diff.files.find((file) => file.status !== "deleted") ?? diff.files[0]
    return firstVisible === undefined ? new Set() : new Set([firstVisible.path])
  })

  useEffect(() => {
    if (open) setHasOpened(true)
  }, [open])

  const toggleFile = (path: string) => {
    setOpenFiles((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return hasOpened ? (
    <ol className="tool-patch-file-list" hidden={!open}>
      {diff.files.map((file, index) => {
        const key = `${index}:${file.path}`
        return (
          <PatchFile
            key={key}
            file={file}
            open={openFiles.has(file.path)}
            toggle={() => toggleFile(file.path)}
          />
        )
      })}
    </ol>
  ) : null
}
