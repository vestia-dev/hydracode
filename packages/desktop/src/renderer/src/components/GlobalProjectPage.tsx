import { useCallback, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { Effect, Fiber } from "effect"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import { AppRuntime } from "../runtime"
import { IconButton } from "./IconButton"

interface GlobalProjectPageProps {
  readonly error: string | null
  readonly createSession: (text: string) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
}

export function GlobalProjectPage({ error: initialError, createSession }: GlobalProjectPageProps) {
  const [text, setText] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(initialError)
  const operationFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const prompt = text.trim()
      if (prompt === "" || pending) return
      setPending(true)
      setError(null)
      operationFiber.current = AppRuntime.runFork(
        createSession(prompt).pipe(
          Effect.catch((cause) =>
            Effect.sync(() => {
              setPending(false)
              setError(cause.message)
            }),
          ),
        ),
      )
    },
    [createSession, pending, text],
  )

  const submitOnEnter = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }, [])

  return (
    <section className="session-landing global-project-page" aria-label="Global project">
      <div className="session-landing__content global-project-page__content">
        <header className="global-project-page__header">
          <p>HydraCode</p>
          <h1>What should the agent work on?</h1>
          <span>Sessions started here run in the OpenCode global context.</span>
        </header>
        <form className="session-landing__composer" onSubmit={submit}>
          <div className="session-landing__input-row">
            <textarea
              aria-label="Start a new session"
              rows={4}
              autoFocus
              value={text}
              disabled={pending}
              placeholder="Describe a task..."
              onChange={(event) => {
                setText(event.target.value)
                setError(null)
              }}
              onKeyDown={submitOnEnter}
            />
            <IconButton
              className="session-landing__send"
              type="submit"
              label={pending ? "Starting session" : "Start session"}
              variant="filled"
              disabled={pending || text.trim() === ""}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
              </svg>
            </IconButton>
          </div>
          <div className="session-landing__composer-footer">
            <span>OpenCode global context</span>
          </div>
        </form>
        {error === null ? null : (
          <p className="session-landing__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
