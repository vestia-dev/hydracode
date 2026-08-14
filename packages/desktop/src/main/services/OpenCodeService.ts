import { Service as LocalOpenCodeService } from "@opencode-ai/client/effect/service"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/effect"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { FetchHttpClient } from "effect/unstable/http"
import { homedir } from "node:os"
import { join } from "node:path"
import type { OpenCodeDiagnostics, OpenCodeServerDiagnostics } from "../../shared/openCode"
import * as OpenCodeInstallation from "./openCodeInstallation"

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
  readonly submitPrompt: (
    sessionID: string,
    text: string,
  ) => Effect.Effect<void, OpenCodeServiceError>
  readonly diagnostics: Effect.Effect<OpenCodeDiagnostics>
  readonly install: Effect.Effect<void, OpenCodeServiceError>
}

export class OpenCodeService extends Context.Service<OpenCodeService, OpenCodeServiceShape>()(
  "HydraCode/OpenCodeService",
) {}

const clientFor = (serviceConnection: OpenCodeConnection) =>
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
  }).pipe(Effect.provide(FetchHttpClient.layer))

const PromptSubmissionResponse = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    sessionID: Schema.String,
    timeCreated: Schema.Number,
    type: Schema.Literal("user"),
    payload: Schema.Struct({ text: Schema.String }),
    delivery: Schema.String,
  }),
})

const submitPromptWith = (connection: OpenCodeConnection, sessionID: string, text: string) =>
  Effect.gen(function* () {
    const base = yield* HttpClient.HttpClient
    const httpClient =
      connection.auth === undefined
        ? base
        : base.pipe(
            HttpClient.mapRequest(
              HttpClientRequest.basicAuth(connection.auth.username, connection.auth.password),
            ),
          )
    const request = yield* HttpClientRequest.post(
      `${connection.url.replace(/\/$/, "")}/api/session/${encodeURIComponent(sessionID)}/prompt`,
    ).pipe(HttpClientRequest.bodyJson({ text }))
    yield* httpClient
      .execute(request)
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(PromptSubmissionResponse)),
      )
  }).pipe(Effect.provide(FetchHttpClient.layer), Effect.asVoid)

export const OpenCodeServiceLive = Layer.effect(
  OpenCodeService,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const defaultServiceFile = join(homedir(), ".local", "state", "opencode", "service.json")
    const xdgServiceFile = join(
      process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"),
      "opencode",
      "service.json",
    )
    const connection = Effect.gen(function* () {
      const inherited = yield* LocalOpenCodeService.discover()
      if (inherited !== undefined) return inherited

      const userLevel = yield* LocalOpenCodeService.discover({
        file: defaultServiceFile,
      })
      if (userLevel !== undefined) return userLevel

      const installation = yield* OpenCodeInstallation.findOpenCodeInstallation
      if (installation === undefined) {
        return yield* new OpenCodeServiceError({
          message: "OpenCode is not installed. Install it from HydraCode Settings to continue.",
          cause: { executable: "opencode2" },
        })
      }

      const endpoint = yield* LocalOpenCodeService.ensure({
        command: [installation.executable, "serve", "--service"],
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
    const [cachedConnection, invalidateConnection] = yield* Effect.cachedInvalidateWithTTL(
      normalizedConnection,
      "5 minutes",
    )
    const [cachedClient, invalidateClient] = yield* Effect.cachedInvalidateWithTTL(
      cachedConnection.pipe(Effect.flatMap(clientFor)),
      "5 minutes",
    )
    const submitPrompt = (sessionID: string, text: string) =>
      cachedConnection.pipe(
        Effect.flatMap((endpoint) => submitPromptWith(endpoint, sessionID, text)),
        Effect.mapError(
          (cause) =>
            new OpenCodeServiceError({
              message:
                cause instanceof Error && cause.message !== ""
                  ? cause.message
                  : "HydraCode could not submit this prompt.",
              cause,
            }),
        ),
      )

    const inspect = (
      source: string,
      registrationFile: string,
    ): Effect.Effect<OpenCodeServerDiagnostics> =>
      Effect.gen(function* () {
        const exists = yield* fileSystem
          .exists(registrationFile)
          .pipe(Effect.orElseSucceed(() => false))
        if (!exists)
          return {
            source,
            registrationFile,
            state: "not-registered" as const,
            authentication: "none" as const,
            advertisedUrls: [],
          }

        const text = yield* fileSystem.readFileString(registrationFile).pipe(Effect.option)
        if (text._tag === "None")
          return {
            source,
            registrationFile,
            state: "invalid" as const,
            authentication: "none" as const,
            advertisedUrls: [],
            error: "HydraCode could not read this registration file.",
          }
        const decoded = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(LocalOpenCodeService.Info),
        )(text.value).pipe(Effect.option)
        if (decoded._tag === "None")
          return {
            source,
            registrationFile,
            state: "invalid" as const,
            authentication: "none" as const,
            advertisedUrls: [],
            error: "This registration file is not valid OpenCode service metadata.",
          }
        const info = decoded.value
        const registered = {
          ...(info.id === undefined ? {} : { instanceID: info.id }),
          registeredUrl: info.url,
          ...(info.version === undefined ? {} : { registeredVersion: info.version }),
          registeredPid: info.pid,
          authentication: info.password === undefined ? ("none" as const) : ("basic" as const),
        }
        const endpoint = yield* LocalOpenCodeService.discover({ file: registrationFile }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        )
        if (endpoint === undefined)
          return {
            source,
            registrationFile,
            state: "unreachable" as const,
            ...registered,
            advertisedUrls: [],
            error: "No healthy server responded to this registration.",
          }
        const serviceConnection: OpenCodeConnection = {
          url: endpoint.url,
          ...(endpoint.auth === undefined ? {} : { auth: endpoint.auth }),
        }
        const result = yield* clientFor(serviceConnection).pipe(
          Effect.flatMap((diagnosticClient) =>
            Effect.all([diagnosticClient.health.get(), diagnosticClient.server.get()], {
              concurrency: "unbounded",
            }),
          ),
          Effect.result,
        )
        if (result._tag === "Failure")
          return {
            source,
            registrationFile,
            state: "unreachable" as const,
            ...registered,
            advertisedUrls: [],
            error:
              result.failure instanceof Error
                ? result.failure.message
                : "HydraCode could not inspect this OpenCode server.",
          }
        const [health, server] = result.success
        return {
          source,
          registrationFile,
          state: "healthy" as const,
          ...registered,
          serverVersion: health.version,
          serverPid: health.pid,
          advertisedUrls: server.urls,
        }
      })

    const serviceFiles =
      xdgServiceFile === defaultServiceFile
        ? [["User service", defaultServiceFile] as const]
        : [
            ["Environment service", xdgServiceFile] as const,
            ["User service", defaultServiceFile] as const,
          ]
    const diagnostics = Effect.all(
      [
        OpenCodeInstallation.findOpenCodeInstallations,
        Effect.forEach(serviceFiles, ([source, file]) => inspect(source, file), {
          concurrency: "unbounded",
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map(([installations, servers]): OpenCodeDiagnostics => ({
        status: servers.some((server) => server.state === "healthy") ? "healthy" : "unavailable",
        installations,
        runningVersions: Array.from(
          new Set(
            servers.flatMap((server) =>
              server.state === "healthy" && server.serverVersion !== undefined
                ? [server.serverVersion]
                : [],
            ),
          ),
        ),
        servers,
      })),
    )
    const install = OpenCodeInstallation.installOpenCode.pipe(
      Effect.andThen(Effect.all([invalidateConnection, invalidateClient])),
      Effect.asVoid,
      Effect.mapError(
        (cause) =>
          new OpenCodeServiceError({
            message:
              cause instanceof Error ? cause.message : "HydraCode could not install OpenCode.",
            cause,
          }),
      ),
    )
    return OpenCodeService.of({
      connection: cachedConnection,
      client: cachedClient,
      submitPrompt,
      diagnostics,
      install,
    })
  }),
)
