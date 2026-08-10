import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { SavedLayoutsFile, type SaveLayoutCommand, type SavedLayout } from "../../shared/layout"

export class LayoutServiceError extends Schema.TaggedErrorClass<LayoutServiceError>()(
  "LayoutServiceError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

interface LayoutServiceShape {
  readonly list: (
    projectID: string,
  ) => Effect.Effect<ReadonlyArray<SavedLayout>, LayoutServiceError>
  readonly save: (command: SaveLayoutCommand) => Effect.Effect<SavedLayout, LayoutServiceError>
}

export class LayoutService extends Context.Service<LayoutService, LayoutServiceShape>()(
  "HydraCode/LayoutService",
) {}

interface LayoutServiceOptions {
  readonly configHome?: string
  readonly home?: string
}

export function layoutPath(options: LayoutServiceOptions = {}) {
  const configHome = options.configHome || join(options.home ?? homedir(), ".config")
  return join(configHome, "hydracode", "layouts.json")
}

function validateLayout(layout: SaveLayoutCommand["layout"]) {
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]))
  if (nodes.size !== layout.nodes.length || !nodes.has(layout.rootID)) return false
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false
    if (visited.has(id)) return true
    const node = nodes.get(id)
    if (node === undefined) return false
    visiting.add(id)
    const valid =
      node._tag === "Pane" ||
      (Number.isFinite(node.ratio) &&
        node.ratio >= 0.15 &&
        node.ratio <= 0.85 &&
        visit(node.first) &&
        visit(node.second))
    visiting.delete(id)
    if (valid) visited.add(id)
    return valid
  }
  return visit(layout.rootID) && visited.size === nodes.size
}

export function makeLayoutServiceLive(options: LayoutServiceOptions = {}) {
  return Layer.effect(
    LayoutService,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = layoutPath(options)
      const directory = dirname(path)

      const read = fileSystem.exists(path).pipe(
        Effect.flatMap((exists) =>
          exists
            ? fileSystem.readFileString(path).pipe(
                Effect.flatMap((source) =>
                  Effect.try({ try: () => JSON.parse(source) as unknown, catch: (cause) => cause }),
                ),
                Effect.flatMap(Schema.decodeUnknownEffect(SavedLayoutsFile)),
              )
            : Effect.succeed([]),
        ),
      )

      const list = (projectID: string) =>
        read.pipe(
          Effect.map(
            (projects) => projects.find((item) => item.projectID === projectID)?.layouts ?? [],
          ),
          Effect.mapError(
            (cause) =>
              new LayoutServiceError({
                message: `HydraCode could not load saved layouts from ${path}.`,
                cause,
              }),
          ),
        )

      const save = (command: SaveLayoutCommand) =>
        Effect.gen(function* () {
          if (!validateLayout(command.layout))
            return yield* new LayoutServiceError({
              message: "HydraCode could not save an invalid pane layout.",
              cause: command.layout,
            })
          const projects = yield* read
          const current = projects.find((item) => item.projectID === command.projectID)
          const serializedLayout = JSON.stringify(command.layout)
          const existing = current?.layouts.find(
            (layout) =>
              layout.id === command.layoutID || JSON.stringify(layout.layout) === serializedLayout,
          )
          const now = Date.now()
          const layout: SavedLayout = {
            id: existing?.id ?? crypto.randomUUID(),
            name: existing?.name ?? command.name,
            created: existing?.created ?? now,
            updated: now,
            layout: command.layout,
          }
          const layouts = [
            layout,
            ...(current?.layouts.filter((item) => item.id !== layout.id) ?? []),
          ]
          const next = [
            { projectID: command.projectID, layouts },
            ...projects.filter((item) => item.projectID !== command.projectID),
          ]
          yield* fileSystem.makeDirectory(directory, { recursive: true })
          yield* fileSystem.writeFileString(path, `${JSON.stringify(next, null, 2)}\n`)
          return layout
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof LayoutServiceError
              ? cause
              : new LayoutServiceError({
                  message: `HydraCode could not save pane layouts to ${path}.`,
                  cause,
                }),
          ),
        )

      return LayoutService.of({ list, save })
    }),
  )
}

export const LayoutServiceLive = makeLayoutServiceLive(
  process.env.XDG_CONFIG_HOME === undefined ? {} : { configHome: process.env.XDG_CONFIG_HOME },
)
