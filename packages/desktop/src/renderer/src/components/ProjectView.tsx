import type { Dispatch, PointerEvent, ReactNode, SetStateAction } from "react"
import { Effect } from "effect"
import type { ProjectSnapshot, SessionView } from "../services/OpenCodeGateway"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import type { Question } from "@opencode-ai/client/effect"
import { groupSessionFamilies } from "../projectors/projectSessions"
import { setPaneSession, setSplitRatio, type PaneLayout } from "../projectors/paneLayout"
import { SessionLanding } from "./SessionLanding"
import { SessionPane } from "./SessionPane"
import type { PaneUIState } from "../../../shared/applicationState"

interface ProjectViewProps {
  readonly snapshot: ProjectSnapshot
  readonly layout: PaneLayout
  readonly activePaneID: string
  readonly promptFocusRequest: { readonly paneID: string; readonly sequence: number } | null
  readonly followLatestRequest: { readonly paneID: string; readonly sequence: number } | null
  readonly landingError: string | null
  readonly setActivePane: (paneID: string) => void
  readonly setLayout: Dispatch<SetStateAction<PaneLayout>>
  readonly selectSession: (
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly createSession: (
    text: string,
    selectCreated?: (sessionID: SessionView["id"] | undefined) => void,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly submitPrompt: (
    sessionID: SessionView["id"],
    text: string,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly replyQuestion: (
    request: Question.Request,
    answers: ReadonlyArray<Question.Answer>,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly rejectQuestion: (
    request: Question.Request,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly interruptSession: (
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly promptRetry: {
    readonly sessionID: SessionView["id"]
    readonly text: string
    readonly message: string
  } | null
  readonly paneUIStates: ReadonlyMap<string, PaneUIState>
  readonly updatePaneUIState: (paneID: string, update: Partial<Omit<PaneUIState, "paneID">>) => void
}

function SplitDivider({
  split,
  setLayout,
}: {
  readonly split: Extract<PaneLayout, { readonly _tag: "Split" }>
  readonly setLayout: Dispatch<SetStateAction<PaneLayout>>
}) {
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const container = event.currentTarget.parentElement
    if (container === null) return
    const bounds = container.getBoundingClientRect()
    const move = (moveEvent: globalThis.PointerEvent) => {
      const ratio =
        split.direction === "horizontal"
          ? (moveEvent.clientX - bounds.left) / bounds.width
          : (moveEvent.clientY - bounds.top) / bounds.height
      setLayout((current) => setSplitRatio(current, split.id, ratio))
    }
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop, { once: true })
  }

  return (
    <div
      className={`pane-divider pane-divider--${split.direction}`}
      role="separator"
      aria-orientation={split.direction === "horizontal" ? "vertical" : "horizontal"}
      onPointerDown={resize}
    />
  )
}

export function ProjectView(props: ProjectViewProps) {
  const families = groupSessionFamilies(props.snapshot.sessions)

  const renderLayout = (layout: PaneLayout): ReactNode => {
    if (layout._tag === "Split") {
      return (
        <div
          key={layout.id}
          className={`pane-split pane-split--${layout.direction}`}
          style={{
            gridTemplateColumns:
              layout.direction === "horizontal"
                ? `${layout.ratio}fr 5px ${1 - layout.ratio}fr`
                : undefined,
            gridTemplateRows:
              layout.direction === "vertical"
                ? `${layout.ratio}fr 5px ${1 - layout.ratio}fr`
                : undefined,
          }}
        >
          {renderLayout(layout.first)}
          <SplitDivider split={layout} setLayout={props.setLayout} />
          {renderLayout(layout.second)}
        </div>
      )
    }

    const family = families.find(({ root }) => root.id === layout.sessionID)
    const selectInPane = (sessionID: SessionView["id"]) =>
      props
        .selectSession(sessionID)
        .pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              props.setLayout((current) => setPaneSession(current, layout.id, sessionID)),
            ),
          ),
        )
    const createInPane = (text: string) =>
      props.createSession(text, (sessionID) =>
        props.setLayout((current) => setPaneSession(current, layout.id, sessionID)),
      )

    return (
      <div
        key={layout.id}
        className={`project-pane${props.activePaneID === layout.id ? " project-pane--active" : ""}`}
        onPointerDownCapture={() => props.setActivePane(layout.id)}
      >
        {family === undefined ? (
          layout.sessionID === undefined ? (
            <SessionLanding
              snapshot={props.snapshot}
              initialError={props.landingError}
              createSession={createInPane}
              selectSession={selectInPane}
              focusRequest={
                props.promptFocusRequest?.paneID === layout.id
                  ? props.promptFocusRequest.sequence
                  : undefined
              }
            />
          ) : (
            <section className="session-pane">
              <div className="empty-state">
                <h1>Loading session</h1>
              </div>
            </section>
          )
        ) : (
          <SessionPane
            key={family.root.id}
            session={family.root}
            descendants={family.descendants}
            submitPrompt={props.submitPrompt}
            replyQuestion={props.replyQuestion}
            rejectQuestion={props.rejectQuestion}
            interruptSession={props.interruptSession}
            retryPrompt={
              props.promptRetry?.sessionID === family.root.id ? props.promptRetry : undefined
            }
            focusPromptRequest={
              props.promptFocusRequest?.paneID === layout.id
                ? props.promptFocusRequest.sequence
                : undefined
            }
            followLatestRequest={
              props.followLatestRequest?.paneID === layout.id
                ? props.followLatestRequest.sequence
                : undefined
            }
            uiState={props.paneUIStates.get(layout.id)}
            updateUIState={(update) => props.updatePaneUIState(layout.id, update)}
          />
        )}
      </div>
    )
  }

  return <div className="pane-layout">{renderLayout(props.layout)}</div>
}
