import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import { Effect, Fiber } from "effect"
import { AppRuntime } from "../runtime"
import type { ProjectView, SessionSummary, SessionView } from "../services/OpenCodeGateway"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import type { ProjectCatalogEntry } from "../../../shared/project"
import {
  locationKey,
  locationsEqual,
  projectLocationLabel,
} from "../../../shared/domain/projectCatalog"
import { projectDisplayName } from "../domain/projectPresentation"
import { IconButton } from "./IconButton"

interface SessionLandingProps {
  readonly snapshot: ProjectView
  readonly project: ProjectCatalogEntry
  readonly initialError: string | null
  readonly createSession: (text: string) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly selectSession: (
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly focusRequest: number | undefined
  readonly selectLocation: (location: ProjectCatalogEntry["locations"][number]["ref"]) => void
}

const sessionDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function LocationIcon({ worktree, className }: { worktree: boolean; className: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h4l1.25 1.25h5.75v6.5a1.25 1.25 0 0 1-1.25 1.25h-8.5a1.25 1.25 0 0 1-1.25-1.25V4.5Z" />
      {worktree ? (
        <>
          <circle cx="5.5" cy="8" r="0.8" />
          <circle cx="5.5" cy="11.3" r="0.8" />
          <circle cx="10.5" cy="8.2" r="0.8" />
          <path d="M5.5 8.8v1.7M9.7 8.2H9A3.5 3.5 0 0 0 5.5 11" />
        </>
      ) : null}
    </svg>
  )
}

export function SessionLanding({
  snapshot,
  project,
  initialError,
  createSession,
  selectSession,
  focusRequest,
  selectLocation,
}: SessionLandingProps) {
  const [text, setText] = useState("")
  const [pending, setPending] = useState<"create" | SessionSummary["id"] | null>(null)
  const [error, setError] = useState<string | null>(initialError)
  const operationFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const landing = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLFormElement>(null)
  const promptInput = useRef<HTMLTextAreaElement>(null)
  const locationPicker = useRef<HTMLDivElement>(null)
  const locationButton = useRef<HTMLButtonElement>(null)
  const continueOnUnmount = useRef(false)
  const locationListID = useId()
  const [showLocations, setShowLocations] = useState(false)
  const selectedLocation =
    project.locations.find(({ ref }) => locationsEqual(ref, snapshot.location)) ??
    project.locations[0]
  const projectName = projectDisplayName(
    project.project.name,
    project.project.canonical,
    project.project.id,
  )

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

  useEffect(() => {
    if (!showLocations) return undefined
    const frame = window.requestAnimationFrame(() => {
      locationPicker.current
        ?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
        ?.focus()
    })
    const closeLocations = (event: MouseEvent | globalThis.KeyboardEvent) => {
      if (event instanceof globalThis.KeyboardEvent) {
        if (event.key !== "Escape") return
        locationButton.current?.focus()
      } else if (event.target instanceof Node && locationPicker.current?.contains(event.target)) {
        return
      }
      setShowLocations(false)
    }
    window.addEventListener("mousedown", closeLocations)
    window.addEventListener("keydown", closeLocations)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("mousedown", closeLocations)
      window.removeEventListener("keydown", closeLocations)
    }
  }, [showLocations])

  return (
    <section ref={landing} className="session-landing" aria-label="New session">
      <div ref={content} className="session-landing__content">
        <form ref={composer} className="session-landing__composer" onSubmit={submit}>
          <div className="session-landing__input-row">
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
            <IconButton
              className="session-landing__send"
              type="submit"
              label={pending === "create" ? "Starting session" : "Start session"}
              variant="filled"
              disabled={pending !== null || text.trim() === ""}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
              </svg>
            </IconButton>
          </div>
          <div className="session-landing__composer-footer">
            <div ref={locationPicker} className="session-landing__location-picker">
              <button
                ref={locationButton}
                className="session-landing__location-trigger"
                type="button"
                aria-label="Session location"
                aria-haspopup="listbox"
                aria-expanded={showLocations}
                aria-controls={showLocations ? locationListID : undefined}
                title={selectedLocation?.ref.directory}
                disabled={pending !== null}
                onClick={() => setShowLocations((visible) => !visible)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
                  event.preventDefault()
                  setShowLocations(true)
                }}
              >
                <LocationIcon
                  className="session-landing__location-icon"
                  worktree={selectedLocation?.kind === "worktree"}
                />
                <span
                  className={`session-landing__location-path${selectedLocation?.kind === "worktree" || selectedLocation?.kind === "canonical" ? " session-landing__location-path--named" : ""}`}
                >
                  {selectedLocation === undefined
                    ? "Choose location"
                    : selectedLocation.kind === "worktree"
                      ? projectLocationLabel(selectedLocation)
                      : selectedLocation.kind === "canonical"
                        ? projectName
                        : selectedLocation.ref.directory}
                </span>
                <svg
                  className="session-landing__location-chevron"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <path d="m3 4.5 3 3 3-3" />
                </svg>
              </button>
              {showLocations ? (
                <div
                  id={locationListID}
                  className="session-landing__location-menu"
                  role="listbox"
                  aria-label="Session location"
                  onKeyDown={(event) => {
                    const options = Array.from(
                      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
                    )
                    const current = options.findIndex((option) => option === document.activeElement)
                    let next: number | undefined
                    if (event.key === "ArrowDown") next = (current + 1) % options.length
                    else if (event.key === "ArrowUp")
                      next = (current - 1 + options.length) % options.length
                    else if (event.key === "Home") next = 0
                    else if (event.key === "End") next = options.length - 1
                    if (next === undefined) return
                    event.preventDefault()
                    options[next]?.focus()
                  }}
                >
                  {project.locations.map((location) => {
                    const selected = locationsEqual(location.ref, snapshot.location)
                    return (
                      <button
                        key={locationKey(location.ref)}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        title={location.ref.directory}
                        onClick={() => {
                          selectLocation(location.ref)
                          setShowLocations(false)
                          locationButton.current?.focus()
                        }}
                      >
                        <span className="session-landing__location-option-copy">
                          <LocationIcon
                            className="session-landing__location-option-icon"
                            worktree={location.kind === "worktree"}
                          />
                          <span
                            className={`session-landing__location-option-path${location.kind === "worktree" || location.kind === "canonical" ? " session-landing__location-option-path--named" : ""}`}
                          >
                            {location.kind === "worktree"
                              ? projectLocationLabel(location)
                              : location.kind === "canonical"
                                ? projectName
                                : location.ref.directory}
                          </span>
                        </span>
                        {selected ? (
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="m3.5 8 3 3 6-6" />
                          </svg>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
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
