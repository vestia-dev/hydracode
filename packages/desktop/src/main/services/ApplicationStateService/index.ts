import { Context, Effect, FileSystem, Layer, Ref, Schema, Semaphore } from "effect"
import { app } from "electron"
import { dirname, join } from "node:path"
import {
  ApplicationStateLoad,
  type ApplicationState as ApplicationStateType,
  type ApplicationStateLoad as ApplicationStateLoadType,
  type ProjectSelectionState,
  type ProjectUIState,
} from "../../../shared/applicationState"
import { locationKey } from "../../../shared/domain/projectCatalog"

export class ApplicationStateServiceError extends Schema.TaggedErrorClass<ApplicationStateServiceError>()(
  "ApplicationStateServiceError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

interface ApplicationStateServiceShape {
  readonly load: Effect.Effect<ApplicationStateLoadType, ApplicationStateServiceError>
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
  version: 2,
  openLocations: [],
  activeLocationKey: null,
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
      const read: Effect.Effect<ApplicationStateLoadType, unknown> = Effect.suspend(() =>
        stateFileExists
          ? readJSON(path).pipe(
              Effect.flatMap((raw) => Schema.decodeUnknownEffect(ApplicationStateLoad)(raw)),
            )
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
      const loaded = yield* read
      const initial: ApplicationStateLoadType =
        loaded.version === 2
          ? {
              ...loaded,
              activeLocationKey:
                loaded.activeLocationKey !== null &&
                loaded.openLocations.some(
                  (item) => locationKey(item.location) === loaded.activeLocationKey,
                )
                  ? loaded.activeLocationKey
                  : loaded.openLocations[0] === undefined
                    ? null
                    : locationKey(loaded.openLocations[0].location),
            }
          : loaded
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
      if (!stateFileExists) yield* write(emptyState)
      const saveSelection = (selection: ProjectSelectionState) =>
        lock.withPermits(1)(
          Ref.get(state).pipe(
            Effect.flatMap((current) => {
              const openLocations = Array.from(
                new Map(
                  selection.openLocations.map((item) => [locationKey(item.location), item]),
                ).values(),
              )
              const selectedKeys = new Set(openLocations.map((item) => locationKey(item.location)))
              return write({
                version: 2,
                openLocations,
                projects: current.version === 2 ? current.projects : [],
                activeLocationKey:
                  selection.activeLocationKey !== null &&
                  selectedKeys.has(selection.activeLocationKey)
                    ? selection.activeLocationKey
                    : openLocations[0] === undefined
                      ? null
                      : locationKey(openLocations[0].location),
              })
            }),
          ),
        )
      const saveProjectUIState = (projectState: ProjectUIState) =>
        lock.withPermits(1)(
          Ref.get(state).pipe(
            Effect.flatMap((current) =>
              write({
                version: 2,
                openLocations: current.version === 2 ? current.openLocations : [],
                activeLocationKey: current.version === 2 ? current.activeLocationKey : null,
                projects: [
                  projectState,
                  ...(current.version === 2 ? current.projects : []).filter(
                    (item) => item.locationKey !== projectState.locationKey,
                  ),
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
