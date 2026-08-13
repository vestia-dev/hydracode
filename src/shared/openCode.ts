import { Schema } from "effect"

export const OpenCodeServerState = Schema.Literals([
  "healthy",
  "unreachable",
  "invalid",
  "not-registered",
])
export type OpenCodeServerState = typeof OpenCodeServerState.Type

export const OpenCodeServerDiagnostics = Schema.Struct({
  source: Schema.String,
  registrationFile: Schema.String,
  state: OpenCodeServerState,
  authentication: Schema.Literals(["none", "basic"]),
  instanceID: Schema.optional(Schema.String),
  registeredUrl: Schema.optional(Schema.String),
  registeredVersion: Schema.optional(Schema.String),
  registeredPid: Schema.optional(Schema.Number),
  serverVersion: Schema.optional(Schema.String),
  serverPid: Schema.optional(Schema.Number),
  advertisedUrls: Schema.Array(Schema.String),
  error: Schema.optional(Schema.String),
})
export type OpenCodeServerDiagnostics = typeof OpenCodeServerDiagnostics.Type

export const OpenCodeDiagnostics = Schema.Struct({
  status: Schema.Literals(["healthy", "unavailable"]),
  installation: Schema.Struct({
    installed: Schema.Boolean,
    executable: Schema.optional(Schema.String),
    version: Schema.optional(Schema.String),
  }),
  servers: Schema.Array(OpenCodeServerDiagnostics),
})
export type OpenCodeDiagnostics = typeof OpenCodeDiagnostics.Type
