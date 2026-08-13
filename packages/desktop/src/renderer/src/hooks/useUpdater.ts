import { useEffect, useState } from "react"
import type { UpdateState } from "../../../shared/update"
import { AppRuntime } from "../runtime"
import { DesktopBridge } from "../services/DesktopBridge"

const restartForUpdate = () => {
  void AppRuntime.runPromise(DesktopBridge.use((desktop) => desktop.restartForUpdate)).catch(
    () => undefined,
  )
}

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: "idle" })

  useEffect(() => {
    let remove: (() => void) | undefined
    let disposed = false
    void AppRuntime.runPromise(DesktopBridge.use((desktop) => desktop.subscribeUpdates(setState)))
      .then((unsubscribe) => {
        if (disposed) unsubscribe()
        else remove = unsubscribe
      })
      .catch((cause) => {
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        })
      })
    return () => {
      disposed = true
      remove?.()
    }
  }, [])

  const install = () => {
    void AppRuntime.runPromise(DesktopBridge.use((desktop) => desktop.installUpdate)).catch(
      (cause) => {
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        })
      },
    )
  }

  return { state, install, restart: restartForUpdate }
}
