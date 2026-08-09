# HydraCode Engineering Guardrails

## Linear project updates

- At the beginning of every session, read this file and the latest Linear project update for the `hydracode` project before planning or changing code.
- Treat the latest project update as the cross-session handoff. Other agents may be working concurrently, so do not rely only on conversation history or an update read earlier by another session.
- Only create or publish a Linear project update when the user explicitly asks for one. Do not publish updates automatically at session end or after completing work.
- When the user requests an update, immediately re-read the latest project update and incorporate any newer concurrent-session information.
- For requested updates, follow the established comprehensive handoff structure: purpose and product direction, repository references, stack, run and verification commands, current Git state, guardrails, architecture map, important domain and UI behavior, tests, working and missing functionality, recommended next steps, and a fresh-session startup checklist.
- Record concrete verification results and material changes in requested updates. Never include credentials, authentication secrets, or other sensitive values.
- If Linear is unavailable when an update was explicitly requested, tell the user that the requested project update could not be published.

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

- Run `bun run lint`, `bun run test`, and `bun run build` before considering implementation work complete.
- Do not suppress diagnostics without documenting the concrete reason.
- Add tests for domain behavior and event projections alongside the implementation.
