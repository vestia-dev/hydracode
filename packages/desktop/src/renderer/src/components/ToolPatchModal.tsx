import { useEffect, useEffectEvent, useId, useRef } from "react"
import { createPortal } from "react-dom"
import type { GraphToolCall } from "../domain/graph"
import { ToolPatchDiff } from "./ToolPatchDiff"

interface ToolPatchModalProps {
  readonly call: GraphToolCall
  readonly close: () => void
  readonly returnFocus: HTMLButtonElement | null
}

export function ToolPatchModal({ call, close, returnFocus }: ToolPatchModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const titleID = useId()
  const closeDialog = useEffectEvent(close)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return undefined
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
    ;(focusable[0] ?? dialog).focus()

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeDialog()
        return
      }
      if (event.key !== "Tab") return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (first === undefined || last === undefined) {
        event.preventDefault()
        dialog.focus()
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [returnFocus])

  if (call.diff === undefined) return null
  return createPortal(
    <div
      className="round-history-backdrop tool-patch-modal-backdrop nodrag nopan"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        ref={dialogRef}
        className="round-history tool-patch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
        tabIndex={-1}
      >
        <header className="round-history__heading">
          <div>
            <span id={titleID}>{call.name}</span>
            <small>
              {call.diff.files.length} {call.diff.files.length === 1 ? "file" : "files"}
            </small>
          </div>
          <button type="button" aria-label="Close patch diff" onClick={close}>
            Close
          </button>
        </header>
        <div className="tool-patch-modal__content nowheel nodrag nopan">
          <ToolPatchDiff diff={call.diff} open />
        </div>
      </section>
    </div>,
    document.body,
  )
}
