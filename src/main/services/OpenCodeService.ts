import { Service as LocalOpenCodeService } from "@opencode-ai/client/effect/service"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/effect"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { FetchHttpClient } from "effect/unstable/http"
import { homedir } from "node:os"
import { join } from "node:path"

export interface OpenCodeConnection {
  readonly url: string
  readonly auth?: { readonly type: "basic"; readonly username: string; readonly password: string }
}

export class OpenCodeServiceError extends Schema.TaggedErrorClass<OpenCodeServiceError>()(
  "OpenCodeServiceError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

interface OpenCodeServiceShape {
  readonly connection: Effect.Effect<OpenCodeConnection, OpenCodeServiceError>
  readonly client: Effect.Effect<OpenCodeClient, OpenCodeServiceError>
}

export class OpenCodeService extends Context.Service<OpenCodeService, OpenCodeServiceShape>()(
  "HydraCode/OpenCodeService",
) {}

export const OpenCodeServiceLive = Layer.effect(
  OpenCodeService,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const defaultServiceFile = join(homedir(), ".local", "state", "opencode", "service.json")

    const connection = Effect.gen(function* () {
      const inherited = yield* LocalOpenCodeService.discover()
      if (inherited !== undefined) return inherited

      const userLevel = yield* LocalOpenCodeService.discover({ file: defaultServiceFile })
      if (userLevel !== undefined) return userLevel

      const endpoint = yield* LocalOpenCodeService.ensure({
        command: ["opencode2", "serve", "--service"],
      })
      return endpoint
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.mapError(
        (cause) =>
          new OpenCodeServiceError({
            message: cause.message || "HydraCode could not connect to the local OpenCode service.",
            cause,
          }),
      ),
    )

    const normalizedConnection = connection.pipe(
      Effect.map((endpoint) => ({
        url: endpoint.url,
        ...(endpoint.auth === undefined ? {} : { auth: endpoint.auth }),
      })),
    )
    const cachedConnection = yield* Effect.cached(normalizedConnection)
    const cachedClient = yield* Effect.cached(
      cachedConnection.pipe(
        Effect.flatMap((serviceConnection) =>
          Effect.gen(function* () {
            const base = yield* HttpClient.HttpClient
            const httpClient =
              serviceConnection.auth === undefined
                ? base
                : base.pipe(
                    HttpClient.mapRequest(
                      HttpClientRequest.basicAuth(
                        serviceConnection.auth.username,
                        serviceConnection.auth.password,
                      ),
                    ),
                  )
            return yield* OpenCode.make({ baseUrl: serviceConnection.url }).pipe(
              Effect.provideService(HttpClient.HttpClient, httpClient),
            )
          }),
        ),
        Effect.provide(FetchHttpClient.layer),
      ),
    )
    return OpenCodeService.of({
      connection: cachedConnection,
      client: cachedClient,
    })
  }),
)
