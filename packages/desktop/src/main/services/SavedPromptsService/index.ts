import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Ref, Schema, Semaphore } from "effect"
import { dirname, join } from "node:path"
import { SavedPromptState, type SavedPrompt } from "../../../shared/savedPrompt"

export class SavedPromptsServiceError extends Schema.TaggedErrorClass<SavedPromptsServiceError>()(
  "SavedPromptsServiceError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

interface SavedPromptsServiceShape {
  readonly list: Effect.Effect<ReadonlyArray<SavedPrompt>, SavedPromptsServiceError>
  readonly save: (text: string) => Effect.Effect<SavedPrompt, SavedPromptsServiceError>
}

export class SavedPromptsService extends Context.Service<
  SavedPromptsService,
  SavedPromptsServiceShape
>()("HydraCode/SavedPromptsService") {}

interface SavedPromptsServiceOptions {
  readonly dataDirectory?: string
}

const emptyState: SavedPromptState = { version: 1, prompts: [] }

export function savedPromptsPath(options: SavedPromptsServiceOptions = {}) {
  return join(options.dataDirectory ?? app.getPath("userData"), "saved-prompts.json")
}

export function makeSavedPromptsServiceLive(options: SavedPromptsServiceOptions = {}) {
  return Layer.effect(
    SavedPromptsService,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = savedPromptsPath(options)
      const exists = yield* fileSystem.exists(path)
      const loaded = yield* exists
        ? fileSystem.readFileString(path).pipe(
            Effect.flatMap((source) =>
              Effect.try({ try: () => JSON.parse(source) as unknown, catch: (cause) => cause }),
            ),
            Effect.flatMap(Schema.decodeUnknownEffect(SavedPromptState)),
            Effect.mapError(
              (cause) =>
                new SavedPromptsServiceError({
                  message: `HydraCode could not load saved prompts from ${path}.`,
                  cause,
                }),
            ),
          )
        : Effect.succeed(emptyState)
      const state = yield* Ref.make(loaded)
      const lock = yield* Semaphore.make(1)
      const write = (next: SavedPromptState) =>
        Effect.gen(function* () {
          const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
          yield* fileSystem.makeDirectory(dirname(path), { recursive: true })
          yield* fileSystem.writeFileString(temporaryPath, `${JSON.stringify(next, null, 2)}\n`)
          yield* fileSystem.rename(temporaryPath, path)
          yield* Ref.set(state, next)
        }).pipe(
          Effect.mapError(
            (cause) =>
              new SavedPromptsServiceError({
                message: `HydraCode could not save prompts to ${path}.`,
                cause,
              }),
          ),
        )
      if (!exists) yield* write(emptyState)
      const save = (input: string) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const text = input.trim()
            if (text === "")
              return yield* new SavedPromptsServiceError({
                message: "Enter a prompt before saving.",
                cause: input,
              })
            const prompt: SavedPrompt = { id: crypto.randomUUID(), text, createdAt: Date.now() }
            const current = yield* Ref.get(state)
            yield* write({ version: 1, prompts: [prompt, ...current.prompts] })
            return prompt
          }),
        )
      return SavedPromptsService.of({
        list: Ref.get(state).pipe(Effect.map(({ prompts }) => prompts)),
        save,
      })
    }),
  )
}

export const SavedPromptsServiceLive = makeSavedPromptsServiceLive()
