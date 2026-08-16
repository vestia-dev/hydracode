import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"

interface ShellResourceModalProps {
  readonly close: () => void
  readonly command: string
  readonly executionMode: "foreground" | "background"
  readonly output?: string
  readonly returnFocus: HTMLButtonElement | null
  readonly running: boolean
  readonly status: string
}

export function ShellResourceModal({
  close,
  command,
  executionMode,
  output,
  returnFocus,
  running,
  status,
}: ShellResourceModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const outputRef = useRef<HTMLPreElement>(null)
  const titleID = useId()
  const closeDialog = useEffectEvent(close)

  useLayoutEffect(() => {
    const outputElement = outputRef.current
    if (outputElement !== null) outputElement.scrollTop = outputElement.scrollHeight
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return undefined
    const closeButton = dialog.querySelector<HTMLButtonElement>("button")
    ;(closeButton ?? dialog).focus()

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeDialog()
      } else if (event.key === "Tab") {
        event.preventDefault()
        ;(closeButton ?? dialog).focus()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [returnFocus])

  return createPortal(
    <div
      className="round-history-backdrop shell-resource-modal-backdrop nodrag nopan"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        ref={dialogRef}
        className="round-history shell-resource-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
        tabIndex={-1}
      >
        <header className="round-history__heading">
          <div>
            <span id={titleID}>Shell command</span>
            <small>
              {status} · {executionMode === "background" ? "Background" : "Foreground"}
            </small>
          </div>
          <button type="button" aria-label="Close shell command" onClick={close}>
            Close
          </button>
        </header>
        <div className="shell-resource-modal__content nowheel nodrag nopan">
          <section>
            <h2>Command</h2>
            <pre>{command}</pre>
          </section>
          <section>
            <h2>
              Output
              {running ? <span>Live</span> : null}
            </h2>
            <pre ref={outputRef}>{output ?? (running ? "Waiting for output..." : "No output")}</pre>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  )
}
