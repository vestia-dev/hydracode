import { useCallback, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { Effect, Fiber } from "effect"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import { AppRuntime } from "../runtime"

interface HomePageProps {
  readonly error: string | null
  readonly createSession: (text: string) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
}

export function HomePage({ error: initialError, createSession }: HomePageProps) {
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
    <section className="session-landing home-page" aria-label="Home">
      <div className="session-landing__content home-page__content">
        <header className="home-page__header">
          <p>HydraCode</p>
          <h1>What should the agent work on?</h1>
          <span>Sessions started here run in your OpenCode home context.</span>
        </header>
        <form className="session-landing__composer" onSubmit={submit}>
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
          <div className="session-landing__composer-footer">
            <span>Enter to send / Shift + Enter for a new line</span>
            <button type="submit" disabled={pending || text.trim() === ""}>
              {pending ? "Starting..." : "Start session"}
            </button>
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
