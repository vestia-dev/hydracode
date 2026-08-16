import type { CSSProperties, Dispatch, PointerEvent, ReactNode, SetStateAction } from "react"
import { Effect } from "effect"
import type { SessionView } from "../services/OpenCodeGateway"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import type { Question } from "@opencode-ai/client/effect"
import { groupSessionFamilies } from "../domain/projectSessions"
import { setSplitRatio, type PaneLayout } from "../domain/paneLayout"
import { SessionLanding } from "./SessionLanding"
import { SessionPane } from "./SessionPane"
import type { PaneContent, PaneUIState } from "../../../shared/applicationState"
import type { ProjectCatalogEntry } from "../../../shared/project"
import type { OpenLocationState } from "../domain/projectLocationState"
import { locationKey } from "../../../shared/domain/projectCatalog"

interface ProjectViewProps {
  readonly locationStates: ReadonlyMap<string, OpenLocationState>
  readonly defaultLocationKey: string
  readonly project: ProjectCatalogEntry
  readonly selectLocation: (location: ProjectCatalogEntry["locations"][number]["ref"]) => void
  readonly layout: PaneLayout
  readonly activePaneID: string
  readonly promptFocusRequest: {
    readonly paneID: string
    readonly sequence: number
  } | null
  readonly followLatestRequest: {
    readonly paneID: string
    readonly sequence: number
  } | null
  readonly landingError: string | null
  readonly setActivePane: (paneID: string) => void
  readonly setLayout: Dispatch<SetStateAction<PaneLayout>>
  readonly selectSession: (
    locationKey: string,
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly createSession: (
    locationKey: string,
    text: string,
    selectCreated?: (sessionID: SessionView["id"] | undefined) => void,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly submitPrompt: (
    locationKey: string,
    sessionID: SessionView["id"],
    text: string,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly replyQuestion: (
    locationKey: string,
    request: Question.Request,
    answers: ReadonlyArray<Question.Answer>,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly rejectQuestion: (
    locationKey: string,
    request: Question.Request,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly backgroundSession: (
    locationKey: string,
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly interruptSession: (
    locationKey: string,
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly paneUIStates: ReadonlyMap<string, PaneUIState>
  readonly updatePaneUIState: (paneID: string, update: Partial<Omit<PaneUIState, "paneID">>) => void
}

interface AxisValue {
  readonly percent: number
  readonly pixels: number
}

interface LayoutBounds {
  readonly x: AxisValue
  readonly y: AxisValue
  readonly width: AxisValue
  readonly height: AxisValue
}

const dividerSize = 5

const scaleAxis = (value: AxisValue, ratio: number, pixels = 0): AxisValue => ({
  percent: value.percent * ratio,
  pixels: value.pixels * ratio + pixels,
})

const addAxis = (left: AxisValue, right: AxisValue, pixels = 0): AxisValue => ({
  percent: left.percent + right.percent,
  pixels: left.pixels + right.pixels + pixels,
})

const axisStyle = ({ percent, pixels }: AxisValue) => `calc(${percent * 100}% + ${pixels}px)`

const boundsStyle = (bounds: LayoutBounds): CSSProperties => ({
  left: axisStyle(bounds.x),
  top: axisStyle(bounds.y),
  width: axisStyle(bounds.width),
  height: axisStyle(bounds.height),
})

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
      style={
        split.direction === "horizontal"
          ? {
              left: `calc(${split.ratio * 100}% - ${split.ratio * dividerSize}px)`,
            }
          : {
              top: `calc(${split.ratio * 100}% - ${split.ratio * dividerSize}px)`,
            }
      }
      onPointerDown={resize}
    />
  )
}

export function ProjectView(props: ProjectViewProps) {
  const panes: Array<{
    readonly pane: Extract<PaneLayout, { readonly _tag: "Pane" }>
    readonly bounds: LayoutBounds
  }> = []
  const splits: Array<{
    readonly split: Extract<PaneLayout, { readonly _tag: "Split" }>
    readonly bounds: LayoutBounds
  }> = []
  const collectLayout = (layout: PaneLayout, bounds: LayoutBounds) => {
    if (layout._tag === "Pane") {
      panes.push({ pane: layout, bounds })
      return
    }
    splits.push({ split: layout, bounds })
    if (layout.direction === "horizontal") {
      const firstWidth = scaleAxis(bounds.width, layout.ratio, -dividerSize * layout.ratio)
      collectLayout(layout.first, { ...bounds, width: firstWidth })
      collectLayout(layout.second, {
        ...bounds,
        x: addAxis(bounds.x, firstWidth, dividerSize),
        width: scaleAxis(bounds.width, 1 - layout.ratio, -dividerSize * (1 - layout.ratio)),
      })
      return
    }
    const firstHeight = scaleAxis(bounds.height, layout.ratio, -dividerSize * layout.ratio)
    collectLayout(layout.first, { ...bounds, height: firstHeight })
    collectLayout(layout.second, {
      ...bounds,
      y: addAxis(bounds.y, firstHeight, dividerSize),
      height: scaleAxis(bounds.height, 1 - layout.ratio, -dividerSize * (1 - layout.ratio)),
    })
  }
  collectLayout(props.layout, {
    x: { percent: 0, pixels: 0 },
    y: { percent: 0, pixels: 0 },
    width: { percent: 1, pixels: 0 },
    height: { percent: 1, pixels: 0 },
  })

  const renderPane = (
    layout: Extract<PaneLayout, { readonly _tag: "Pane" }>,
    bounds: LayoutBounds,
  ): ReactNode => {
    const content: PaneContent = props.paneUIStates.get(layout.id)?.content ?? {
      _tag: "NewSession",
      locationKey: props.defaultLocationKey,
    }
    const sessionLocation =
      content._tag === "Session"
        ? Array.from(props.locationStates.entries()).find(([, state]) =>
            state.snapshot === undefined
              ? false
              : state.snapshot.sessions.some((session) => session.id === content.sessionID) ||
                state.snapshot.recentSessions.some((session) => session.id === content.sessionID),
          )
        : undefined
    const paneLocationKey =
      content._tag === "NewSession"
        ? content.locationKey
        : (sessionLocation?.[0] ?? props.defaultLocationKey)
    const locationState = props.locationStates.get(paneLocationKey)
    const snapshot = locationState?.snapshot
    const families = groupSessionFamilies(snapshot?.sessions ?? [])
    const family =
      content._tag === "Session"
        ? families.find(({ root }) => root.id === content.sessionID)
        : undefined
    const selectInPane = (sessionID: SessionView["id"]) =>
      props.selectSession(paneLocationKey, sessionID).pipe(
        Effect.tap(() =>
          Effect.sync(() =>
            props.updatePaneUIState(layout.id, {
              content: { _tag: "Session", sessionID },
            }),
          ),
        ),
      )
    const createInPane = (text: string) =>
      props.createSession(paneLocationKey, text, (sessionID) =>
        props.updatePaneUIState(layout.id, {
          content:
            sessionID === undefined
              ? { _tag: "NewSession", locationKey: paneLocationKey }
              : { _tag: "Session", sessionID },
        }),
      )

    return (
      <div
        key={layout.id}
        className={`project-pane${props.activePaneID === layout.id ? " project-pane--active" : ""}`}
        style={boundsStyle(bounds)}
        onPointerDownCapture={() => props.setActivePane(layout.id)}
      >
        {content._tag === "Session" && family === undefined ? (
          <section className="session-pane">
            <div className="empty-state">
              <h1>Loading session</h1>
            </div>
          </section>
        ) : snapshot === undefined ? (
          <section className="session-pane">
            <div className="empty-state">
              <h1>Connecting to location</h1>
            </div>
          </section>
        ) : content._tag === "NewSession" ? (
          <SessionLanding
            snapshot={snapshot}
            project={props.project}
            selectLocation={(location) => {
              props.selectLocation(location)
              props.updatePaneUIState(layout.id, {
                content: { _tag: "NewSession", locationKey: locationKey(location) },
              })
            }}
            initialError={locationState?.landingError ?? props.landingError}
            createSession={createInPane}
            selectSession={selectInPane}
            focusRequest={
              props.promptFocusRequest?.paneID === layout.id
                ? props.promptFocusRequest.sequence
                : undefined
            }
          />
        ) : family === undefined ? (
          <section className="session-pane">
            <div className="empty-state">
              <h1>Loading session</h1>
            </div>
          </section>
        ) : (
          <SessionPane
            key={family.root.id}
            session={family.root}
            descendants={family.descendants}
            directory={(family.root.location ?? snapshot.location).directory}
            submitPrompt={(sessionID, text) => props.submitPrompt(paneLocationKey, sessionID, text)}
            replyQuestion={(request, answers) =>
              props.replyQuestion(paneLocationKey, request, answers)
            }
            rejectQuestion={(request) => props.rejectQuestion(paneLocationKey, request)}
            backgroundSession={(sessionID) => props.backgroundSession(paneLocationKey, sessionID)}
            interruptSession={(sessionID) => props.interruptSession(paneLocationKey, sessionID)}
            retryPrompt={
              locationState?.promptRetry?.sessionID === family.root.id
                ? locationState.promptRetry
                : undefined
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

  return (
    <div className="pane-layout">
      {panes.map(({ pane, bounds }) => renderPane(pane, bounds))}
      {splits.map(({ split, bounds }) => (
        <div
          key={split.id}
          className={`pane-split pane-split--${split.direction}`}
          style={boundsStyle(bounds)}
        >
          <SplitDivider split={split} setLayout={props.setLayout} />
        </div>
      ))}
    </div>
  )
}
