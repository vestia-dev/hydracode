# HydraCode Engineering Guardrails

## Dependency policy

- Do not add, remove, or update a dependency without explicit user approval.
- Before requesting approval, state the exact version, whether it is a runtime or development dependency, its purpose, and why existing dependencies are insufficient.
- Prefer capabilities already provided by Effect and the platform.

## Effect architecture

- Effect is the application architecture in Electron main, preload adapters, and the renderer.
- Keep `Effect.run*` calls at runtime boundaries only.
- Model expected failures with typed errors; do not throw them.
- Validate external, persisted, and IPC data with Effect Schema.
- Put side effects and external integrations behind Effect services and Layers.
- Acquire long-lived resources with scopes and release them deterministically.
- Use Effect concurrency primitives for background work and streaming.
- Keep projections from OpenCode events to domain state deterministic and replay-testable.

## Desktop boundaries

- Electron renderers must use context isolation, sandboxing, and no Node integration.
- Expose the smallest possible typed preload API.
- Keep process management, filesystem access, credentials, and native capabilities in the main process.
- Treat OpenCode as the authority for agent history and HydraCode as a projection of it.

## Verification

- Run `bun run lint`, `bun run test`, and `bun run build` from `packages/desktop` before considering desktop implementation work complete.
- Do not suppress diagnostics without documenting the concrete reason.
- Add tests for domain behavior and event projections alongside the implementation.

### Electron UI inspection

- Use the `chrome-devtools-electron` tools to inspect the real Electron renderer. Do not use the regular `chrome-devtools` tools or open the Vite URL in Chrome; standalone Chrome does not have the preload-provided `window.hydracode` API.
- Before UI inspection, check whether `http://127.0.0.1:9333/json/version` is already available. Never start a dev server or Electron instance yourself; if it is unavailable, ask the user to start it.
- Confirm the selected page is titled `HydraCode` and that `window.hydracode` exists before relying on inspection results.
- Use snapshots, console messages, network requests, and interaction through `chrome-devtools-electron` to verify renderer changes when relevant.
- Never stop a dev server or Electron instance started by the user.

### OpenCode server inspection

- Use `tools.opencode.api` to query or operate on an OpenCode V2 server. It delegates to `opencode2 api`, preserving the CLI's managed-service discovery and authentication.
- Prefer method and path calls such as `{ method: "get", path: "/api/health" }`. OpenAPI operation IDs are also supported and use dotted names such as `v2.health.get`.
- Pass request bodies as valid JSON strings in `data`. Use `params` for OpenAPI path and query parameters, and only use `server` when intentionally targeting an explicit OpenCode server.
- Do not expose credentials or authorization headers in responses or logs.
