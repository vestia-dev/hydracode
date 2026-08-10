import type { UpdateState } from "../../shared/update"

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
  let pending: Promise<UpdateState> | undefined
  const listeners = new Set<(state: UpdateState) => void>()

  const transition = (next: UpdateState) => {
    state = next
    for (const listener of listeners) listener(state)
    return state
  }

  const check = (options: { readonly silent?: boolean } = {}) => {
    if (!input.enabled || state.status === "ready") return Promise.resolve(state)
    if (pending !== undefined) return pending

    pending = (async () => {
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

      transition({ status: "downloading", version })
      await input.backend.downloadUpdate()
      return transition({ status: "ready", version })
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
        pending = undefined
      })

    return pending
  }

  return {
    subscribe(listener: (state: UpdateState) => void) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    check,
    install() {
      if (state.status !== "ready") return false
      const version = state.version
      transition({ status: "installing", version })
      input.backend.quitAndInstall()
      return true
    },
  }
}
