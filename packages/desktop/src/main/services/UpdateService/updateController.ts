import type { UpdateState } from "../../../shared/update"

export interface UpdateBackend {
  readonly currentVersion: string
  readonly checkForUpdates: () => Promise<{
    readonly isUpdateAvailable?: boolean
    readonly updateInfo?: { readonly version?: string }
  } | null>
  readonly downloadUpdate: () => Promise<unknown>
  readonly quitAndInstall: () => void
}

export function createUpdateController(input: {
  readonly enabled: boolean
  readonly backend: UpdateBackend
}) {
  let state: UpdateState = input.enabled ? { status: "idle" } : { status: "disabled" }
  let pending:
    | { readonly _tag: "Check"; readonly promise: Promise<UpdateState> }
    | { readonly _tag: "Install"; readonly promise: Promise<UpdateState> }
    | undefined
  const listeners = new Set<(state: UpdateState) => void>()

  const transition = (next: UpdateState) => {
    state = next
    for (const listener of listeners) listener(state)
    return state
  }

  const check = (options: { readonly silent?: boolean } = {}) => {
    if (!input.enabled || state.status === "available" || state.status === "ready")
      return Promise.resolve(state)
    if (pending !== undefined) return pending.promise

    const promise = (async () => {
      transition({ status: "checking" })
      const result = await input.backend.checkForUpdates()
      const version = result?.updateInfo?.version
      if (
        !result?.isUpdateAvailable ||
        version === undefined ||
        version === input.backend.currentVersion
      ) {
        return transition({ status: "up-to-date" })
      }

      return transition({ status: "available", version })
    })()
      .catch((cause) =>
        options.silent
          ? transition({ status: "idle" })
          : transition({
              status: "error",
              message: cause instanceof Error ? cause.message : String(cause),
            }),
      )
      .finally(() => {
        if (pending?.promise === promise) pending = undefined
      })
    pending = { _tag: "Check", promise }
    return promise
  }

  return {
    subscribe(listener: (state: UpdateState) => void) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    check,
    install() {
      if (pending?._tag === "Install") return pending.promise
      if (pending?._tag === "Check") return undefined
      if (state.status === "ready") return Promise.resolve(state)
      if (state.status !== "available") return undefined
      const version = state.version
      transition({ status: "downloading", version })
      const promise = input.backend
        .downloadUpdate()
        .then(() => transition({ status: "ready", version }))
        .catch((cause) =>
          transition({
            status: "error",
            message: cause instanceof Error ? cause.message : String(cause),
          }),
        )
        .finally(() => {
          if (pending?.promise === promise) pending = undefined
        })
      pending = { _tag: "Install", promise }
      return promise
    },
    restart() {
      if (state.status !== "ready") return false
      input.backend.quitAndInstall()
      return true
    },
  }
}
