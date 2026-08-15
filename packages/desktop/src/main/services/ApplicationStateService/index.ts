import { Context, Effect, FileSystem, Layer, Ref, Schema, Semaphore } from "effect"
import { app } from "electron"
import { dirname, join } from "node:path"
import {
  ApplicationState,
  type ApplicationState as ApplicationStateType,
  type ProjectSelectionState,
  type ProjectUIState,
} from "../../../shared/applicationState"

export class ApplicationStateServiceError extends Schema.TaggedErrorClass<ApplicationStateServiceError>()(
  "ApplicationStateServiceError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

interface ApplicationStateServiceShape {
  readonly load: Effect.Effect<ApplicationStateType, ApplicationStateServiceError>
  readonly saveSelection: (
    selection: ProjectSelectionState,
  ) => Effect.Effect<ApplicationStateType, ApplicationStateServiceError>
  readonly saveProjectUIState: (
    state: ProjectUIState,
  ) => Effect.Effect<ProjectUIState, ApplicationStateServiceError>
}

export class ApplicationStateService extends Context.Service<
  ApplicationStateService,
  ApplicationStateServiceShape
>()("HydraCode/ApplicationStateService") {}

interface ApplicationStateServiceOptions {
  readonly dataDirectory?: string
}

const emptyState: ApplicationStateType = {
  version: 1,
  openProjectIDs: [],
  activeProjectID: null,
  projects: [],
}

export function applicationStatePath(options: ApplicationStateServiceOptions = {}) {
  return join(options.dataDirectory ?? app.getPath("userData"), "application-state.json")
}

export function makeApplicationStateServiceLive(options: ApplicationStateServiceOptions = {}) {
  return Layer.effect(
    ApplicationStateService,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = applicationStatePath(options)
      const readJSON = (filePath: string) =>
        fileSystem
          .readFileString(filePath)
          .pipe(
            Effect.flatMap((source) =>
              Effect.try({ try: () => JSON.parse(source) as unknown, catch: (cause) => cause }),
            ),
          )
      const stateFileExists = yield* fileSystem.exists(path)
      const read = Effect.suspend(() =>
        stateFileExists
          ? readJSON(path).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ApplicationState)))
          : Effect.succeed(emptyState),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new ApplicationStateServiceError({
              message: `HydraCode could not load its application state from ${path}.`,
              cause,
            }),
        ),
      )
      const initial = yield* read
      const state = yield* Ref.make(initial)
      const lock = yield* Semaphore.make(1)
      const write = (next: ApplicationStateType) =>
        Effect.gen(function* () {
          const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
          yield* fileSystem.makeDirectory(dirname(path), { recursive: true })
          yield* fileSystem.writeFileString(temporaryPath, `${JSON.stringify(next, null, 2)}\n`)
          yield* fileSystem.rename(temporaryPath, path)
          yield* Ref.set(state, next)
          return next
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ApplicationStateServiceError({
                message: `HydraCode could not save its application state to ${path}.`,
                cause,
              }),
          ),
        )
      if (!stateFileExists) yield* write(initial)
      const saveSelection = (selection: ProjectSelectionState) =>
        lock.withPermits(1)(
          Ref.get(state).pipe(
            Effect.flatMap((current) => {
              const openProjectIDs = Array.from(new Set(selection.openProjectIDs))
              return write({
                ...current,
                openProjectIDs,
                activeProjectID:
                  selection.activeProjectID !== null &&
                  openProjectIDs.includes(selection.activeProjectID)
                    ? selection.activeProjectID
                    : (openProjectIDs[0] ?? null),
              })
            }),
          ),
        )
      const saveProjectUIState = (projectState: ProjectUIState) =>
        lock.withPermits(1)(
          Ref.get(state).pipe(
            Effect.flatMap((current) =>
              write({
                ...current,
                projects: [
                  projectState,
                  ...current.projects.filter((item) => item.projectID !== projectState.projectID),
                ],
              }),
            ),
            Effect.as(projectState),
          ),
        )
      return ApplicationStateService.of({ load: Ref.get(state), saveSelection, saveProjectUIState })
    }),
  )
}

export const ApplicationStateServiceLive = makeApplicationStateServiceLive()
