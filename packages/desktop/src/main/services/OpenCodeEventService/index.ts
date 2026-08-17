import type { OpenCodeEvent } from "@opencode-ai/client/effect"
import { Context, Effect, Layer, Scope, Semaphore, Stream } from "effect"
import { OpenCodeService } from "../OpenCodeService"

type EventListener = (event: OpenCodeEvent) => Effect.Effect<void>

interface OpenCodeEventServiceShape {
  readonly subscribe: (listener: EventListener) => Effect.Effect<void, unknown>
}

export class OpenCodeEventService extends Context.Service<
  OpenCodeEventService,
  OpenCodeEventServiceShape
>()("HydraCode/OpenCodeEventService") {}

export const OpenCodeEventServiceLive = Layer.effect(
  OpenCodeEventService,
  Effect.gen(function* () {
    const openCode = yield* OpenCodeService
    const scope = yield* Scope.Scope
    const listeners = new Set<EventListener>()
    const startLock = yield* Semaphore.make(1)
    let started = false

    const watchServer = Effect.gen(function* () {
      const client = yield* openCode.client
      const consume = client.event
        .subscribe()
        .pipe(
          Stream.runForEach((event) =>
            Effect.forEach(listeners, (listener) => listener(event), { discard: true }),
          ),
        )
      const loop: Effect.Effect<never> = consume.pipe(
        Effect.catch((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("OpenCode event stream disconnected", cause)
            yield* Effect.sleep("500 millis")
          }),
        ),
        Effect.andThen(Effect.suspend(() => loop)),
      )
      return yield* loop
    })

    const subscribe = (listener: EventListener) =>
      Effect.sync(() => listeners.add(listener)).pipe(
        Effect.andThen(
          startLock.withPermits(1)(
            Effect.gen(function* () {
              if (started) return
              yield* Effect.forkIn(watchServer, scope)
              started = true
            }),
          ),
        ),
        Effect.asVoid,
      )

    return OpenCodeEventService.of({ subscribe })
  }),
)
