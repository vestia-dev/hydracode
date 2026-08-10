import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { Effect, Fiber } from "effect"
import { AppRuntime } from "../runtime"
import type { ProjectSnapshot, SessionSummary, SessionView } from "../services/OpenCodeGateway"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"

interface SessionLandingProps {
  readonly snapshot: ProjectSnapshot
  readonly initialError: string | null
  readonly createSession: (text: string) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly selectSession: (
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
}

const sessionDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function SessionLanding({
  snapshot,
  initialError,
  createSession,
  selectSession,
}: SessionLandingProps) {
  const [text, setText] = useState("")
  const [pending, setPending] = useState<"create" | SessionSummary["id"] | null>(null)
  const [error, setError] = useState<string | null>(initialError)
  const operationFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
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

  return (
    <section className="session-landing" aria-labelledby="session-landing-title">
      <div className="session-landing__content">
        <div className="session-landing__intro">
          <span className="empty-mark" aria-hidden="true">
            H
          </span>
          <div>
            <h1 id="session-landing-title">Start a new session</h1>
            <p>Describe what you want to work on. The session starts when you send the prompt.</p>
          </div>
        </div>

        <form className="session-landing__composer" onSubmit={submit}>
          <textarea
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
