import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { Effect, Fiber } from "effect"
import { AppRuntime } from "../runtime"
import type { ProjectSnapshot, SessionSummary, SessionView } from "../services/OpenCodeGateway"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import type { SavedLayout } from "../../../shared/layout"
import { paneCount, restorePaneLayout, type PaneLayout } from "../projectors/paneLayout"

interface SessionLandingProps {
  readonly snapshot: ProjectSnapshot
  readonly initialError: string | null
  readonly savedLayouts: ReadonlyArray<SavedLayout>
  readonly savedLayoutsError: string | null
  readonly createSession: (text: string) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly selectSession: (
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly focusRequest: number | undefined
  readonly openSavedLayout: (
    layout: SavedLayout,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
}

const sessionDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function SessionLanding({
  snapshot,
  initialError,
  savedLayouts,
  savedLayoutsError,
  createSession,
  selectSession,
  focusRequest,
  openSavedLayout,
}: SessionLandingProps) {
  const [text, setText] = useState("")
  const [pending, setPending] = useState<
    "create" | SessionSummary["id"] | `layout:${string}` | null
  >(null)
  const [error, setError] = useState<string | null>(initialError)
  const operationFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const landing = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLFormElement>(null)
  const promptInput = useRef<HTMLTextAreaElement>(null)
  const continueOnUnmount = useRef(false)

  const run = useCallback((effect: Effect.Effect<void, DesktopBridgeError, DesktopBridge>) => {
    const previous = operationFiber.current
    if (previous !== null) AppRuntime.runFork(Fiber.interrupt(previous))
    operationFiber.current = AppRuntime.runFork(
      effect.pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            setPending(null)
            setError(cause.message)
          }),
        ),
      ),
    )
  }, [])

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const prompt = text.trim()
      if (prompt === "" || pending !== null) return
      setPending("create")
      setError(null)
      continueOnUnmount.current = true
      run(createSession(prompt))
    },
    [createSession, pending, run, text],
  )

  const submitOnEnter = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }, [])

  useEffect(
    () => () => {
      const fiber = operationFiber.current
      if (fiber !== null && !continueOnUnmount.current) AppRuntime.runFork(Fiber.interrupt(fiber))
    },
    [],
  )

  useEffect(() => {
    if (focusRequest === undefined) return
    const landingElement = landing.current
    const contentElement = content.current
    const composerElement = composer.current
    if (landingElement !== null && contentElement !== null && composerElement !== null) {
      const paddingTop = Math.max(
        24,
        (landingElement.clientHeight - composerElement.offsetHeight) / 2,
      )
      contentElement.style.paddingTop = `${paddingTop}px`
      landingElement.scrollTo({ top: 0, behavior: "smooth" })
    }
    promptInput.current?.focus({ preventScroll: true })
  }, [focusRequest])

  return (
    <section ref={landing} className="session-landing" aria-label="New session">
      <div ref={content} className="session-landing__content">
        <form ref={composer} className="session-landing__composer" onSubmit={submit}>
          <textarea
            ref={promptInput}
            aria-label="Start a new session"
            rows={4}
            autoFocus
            value={text}
            disabled={pending !== null}
            placeholder="What should the agent work on?"
            onChange={(event) => {
              setText(event.target.value)
              setError(null)
            }}
            onKeyDown={submitOnEnter}
          />
          <div className="session-landing__composer-footer">
            <span>Enter to send / Shift + Enter for a new line</span>
            <button type="submit" disabled={pending !== null || text.trim() === ""}>
              {pending === "create" ? "Starting..." : "Start session"}
            </button>
          </div>
        </form>

        {error === null ? null : (
          <p className="session-landing__error" role="alert">
            {error}
          </p>
        )}

        <div className="session-landing__history session-landing__saved-layouts">
          <div className="session-landing__history-heading">
            <h2>Saved layouts</h2>
            <span>{savedLayouts.length}</span>
          </div>
          {savedLayoutsError !== null ? (
            <p className="session-landing__error" role="alert">
              {savedLayoutsError}
            </p>
          ) : savedLayouts.length === 0 ? (
            <p className="session-landing__no-sessions">
              Configure your panes, then press Cmd/Ctrl + S to save the layout.
            </p>
          ) : (
            <div className="session-landing__session-list">
              {savedLayouts.map((layout) => {
                const restored = restorePaneLayout(layout.layout)
                const pendingID = `layout:${layout.id}` as const
                return (
                  <button
                    key={layout.id}
                    type="button"
                    className="session-landing__session session-landing__layout"
                    disabled={pending !== null || restored === undefined}
                    onClick={() => {
                      setPending(pendingID)
                      setError(null)
                      continueOnUnmount.current = false
                      run(openSavedLayout(layout))
                    }}
                  >
                    {restored === undefined ? null : <LayoutPreview layout={restored} />}
                    <span className="session-landing__session-title">{layout.name}</span>
                    <span className="session-landing__session-meta">
                      <span>
                        {restored === undefined ? "Invalid" : `${paneCount(restored)} panes`}
                      </span>
                      <time dateTime={new Date(layout.updated).toISOString()}>
                        {sessionDate.format(layout.updated)}
                      </time>
                      <span>{pending === pendingID ? "Opening..." : "Open"}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="session-landing__history">
          <div className="session-landing__history-heading">
            <h2>Existing sessions</h2>
            <span>{snapshot.recentSessions.length}</span>
          </div>
          {snapshot.recentSessions.length === 0 ? (
            <p className="session-landing__no-sessions">No sessions in this project yet.</p>
          ) : (
            <div className="session-landing__session-list">
              {snapshot.recentSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="session-landing__session"
                  disabled={pending !== null}
                  onClick={() => {
                    setPending(session.id)
                    setError(null)
                    continueOnUnmount.current = false
                    run(selectSession(session.id))
                  }}
                >
                  <span className="session-landing__session-title">{session.title}</span>
                  <span className="session-landing__session-meta">
                    {session.active ? <strong>Active</strong> : null}
                    <time dateTime={new Date(session.created).toISOString()}>
                      {sessionDate.format(session.created)}
                    </time>
                    <span>{pending === session.id ? "Opening..." : "Open"}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function LayoutPreview({ layout }: { readonly layout: PaneLayout }) {
  if (layout._tag === "Pane") return <span className="layout-preview__pane" />
  return (
    <span
      className={`layout-preview__split layout-preview__split--${layout.direction}`}
      style={{
        gridTemplateColumns:
          layout.direction === "horizontal" ? `${layout.ratio}fr ${1 - layout.ratio}fr` : undefined,
        gridTemplateRows:
          layout.direction === "vertical" ? `${layout.ratio}fr ${1 - layout.ratio}fr` : undefined,
      }}
    >
      <LayoutPreview layout={layout.first} />
      <LayoutPreview layout={layout.second} />
    </span>
  )
}
