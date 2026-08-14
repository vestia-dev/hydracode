import { Effect, Fiber } from "effect"
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { BundledThemes, bundledThemeID, type BundledThemeID } from "../../../shared/theme"
import type { OpenCodeDiagnostics } from "../../../shared/openCode"
import { AppRuntime } from "../runtime"
import { DesktopBridge } from "../services/DesktopBridge"
import { useTheme, useThemeUpdate } from "../theme"
import { IconButton } from "./IconButton"

const themeDescriptions: Record<BundledThemeID, string> = {
  "hydracode-dark": "Low-glare charcoal surfaces for focused work.",
  "hydracode-light": "Warm neutral surfaces with crisp contrast.",
}

interface SettingsModalProps {
  readonly close: () => void
  readonly returnFocus: HTMLElement | null
}

export function SettingsModal({ close, returnFocus }: SettingsModalProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const titleID = useId()
  const closeDialog = useEffectEvent(close)
  const theme = useTheme()
  const updateTheme = useThemeUpdate()
  const [saving, setSaving] = useState<BundledThemeID>()
  const [error, setError] = useState<string>()
  const [diagnostics, setDiagnostics] = useState<OpenCodeDiagnostics>()
  const [diagnosticsError, setDiagnosticsError] = useState<string>()
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false)
  const [installingOpenCode, setInstallingOpenCode] = useState(false)
  const selectedTheme = bundledThemeID(theme)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return undefined
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
    ;(focusable()[0] ?? dialog).focus()

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeDialog()
        return
      }
      if (event.key !== "Tab") return
      const elements = focusable()
      const first = elements[0]
      const last = elements.at(-1)
      if (first === undefined || last === undefined) {
        event.preventDefault()
        dialog.focus()
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [returnFocus])

  const loadDiagnostics = useCallback(() => {
    setLoadingDiagnostics(true)
    setDiagnosticsError(undefined)
    return AppRuntime.runFork(
      DesktopBridge.use((desktop) => desktop.getOpenCodeDiagnostics).pipe(
        Effect.match({
          onFailure: (cause) => {
            setDiagnosticsError(
              cause.message || "HydraCode could not inspect the local OpenCode service.",
            )
            setLoadingDiagnostics(false)
          },
          onSuccess: (next) => {
            setDiagnostics(next)
            setLoadingDiagnostics(false)
          },
        }),
      ),
    )
  }, [])

  useEffect(() => {
    const fiber = loadDiagnostics()
    return () => {
      AppRuntime.runFork(Fiber.interrupt(fiber))
    }
  }, [loadDiagnostics])

  const installOpenCode = () => {
    if (
      !window.confirm(
        "Install the latest OpenCode V2 release using the official installer from anomalyco/opencode?",
      )
    )
      return
    setInstallingOpenCode(true)
    setDiagnosticsError(undefined)
    void AppRuntime.runPromise(DesktopBridge.use((desktop) => desktop.installOpenCode)).then(
      () => {
        setInstallingOpenCode(false)
        loadDiagnostics()
      },
      (cause) => {
        setDiagnosticsError(
          cause instanceof Error ? cause.message : "HydraCode could not install OpenCode.",
        )
        setInstallingOpenCode(false)
      },
    )
  }

  const selectTheme = (id: BundledThemeID) => {
    setSaving(id)
    setError(undefined)
    void AppRuntime.runPromise(DesktopBridge.use((desktop) => desktop.setBundledTheme(id))).then(
      (nextTheme) => {
        updateTheme(nextTheme)
        setSaving(undefined)
      },
      (cause) => {
        setError(cause instanceof Error ? cause.message : "HydraCode could not save the theme.")
        setSaving(undefined)
      },
    )
  }

  return createPortal(
    <div
      className="settings-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        ref={dialogRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
        tabIndex={-1}
      >
        <header className="settings-modal__header">
          <div>
            <p className="settings-modal__eyebrow">HydraCode</p>
            <h1 id={titleID}>Settings</h1>
            <p>Inspect the desktop runtime and choose how the interface looks and feels.</p>
          </div>
          <IconButton
            type="button"
            className="settings-modal__close"
            label="Close settings"
            variant="ghost"
            onClick={close}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m3 3 10 10M13 3 3 13" />
            </svg>
          </IconButton>
        </header>
        <div className="settings-modal__content">
          <section className="settings-section" aria-labelledby="appearance-title">
            <div className="settings-section__heading">
              <div>
                <h2 id="appearance-title">Appearance</h2>
                <p>Theme changes apply immediately across every open session.</p>
              </div>
            </div>

            <div className="theme-options" role="radiogroup" aria-label="Bundled themes">
              {BundledThemes.map((entry) => {
                const selected = entry.id === selectedTheme
                const pending = entry.id === saving
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`theme-option${selected ? " theme-option--selected" : ""}`}
                    disabled={saving !== undefined}
                    onClick={() => selectTheme(entry.id)}
                  >
                    <span
                      className="theme-option__preview"
                      style={{
                        color: entry.theme.colors.text,
                        background: entry.theme.colors.background,
                        borderColor: entry.theme.colors.border,
                      }}
                      aria-hidden="true"
                    >
                      <span style={{ background: entry.theme.colors.surface }} />
                      <span style={{ background: entry.theme.colors.surfaceMuted }} />
                      <i style={{ background: entry.theme.colors.accent }} />
                    </span>
                    <span className="theme-option__copy">
                      <strong>{entry.theme.name}</strong>
                      <span>{themeDescriptions[entry.id]}</span>
                    </span>
                    <span className="theme-option__status" aria-hidden="true">
                      {pending ? "Saving" : selected ? "Selected" : ""}
                    </span>
                  </button>
                )
              })}
            </div>

            {error === undefined ? null : (
              <p className="settings-error" role="alert">
                {error}
              </p>
            )}
          </section>

          <section className="settings-section" aria-labelledby="opencode-title">
            <div className="settings-section__heading">
              <div>
                <h2 id="opencode-title">OpenCode</h2>
                <p>Installation and service status for the OpenCode client HydraCode uses.</p>
              </div>
              <div className="diagnostics-actions">
                {diagnostics?.installations.length === 0 ? (
                  <button
                    type="button"
                    className="open-project-button"
                    disabled={installingOpenCode}
                    onClick={installOpenCode}
                  >
                    {installingOpenCode ? "Installing..." : "Install OpenCode"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="open-project-button"
                  disabled={loadingDiagnostics || installingOpenCode}
                  onClick={loadDiagnostics}
                >
                  {loadingDiagnostics ? "Inspecting..." : "Refresh"}
                </button>
              </div>
            </div>

            {diagnostics === undefined ? (
              <div className="diagnostics-empty" aria-live="polite">
                {loadingDiagnostics
                  ? "Inspecting local OpenCode services..."
                  : "No diagnostics loaded."}
              </div>
            ) : (
              <div className="diagnostics-table-wrap">
                <table className="diagnostics-table">
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th>Version</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostics.installations.map((installation) => {
                      const runningServer = diagnostics.servers.find(
                        (server) =>
                          server.state === "healthy" &&
                          server.serverVersion === installation.version,
                      )
                      const running = runningServer !== undefined
                      return (
                        <tr key={installation.executable}>
                          <td>
                            <code>{installation.executable}</code>
                          </td>
                          <td>
                            <code>{installation.version}</code>
                          </td>
                          <td>
                            <strong
                              className={`diagnostics-status diagnostics-status--${
                                running ? "compatible" : "installed"
                              }`}
                            >
                              {running
                                ? `Running (PID ${runningServer.serverPid ?? runningServer.registeredPid ?? "unknown"})`
                                : "Not running"}
                            </strong>
                          </td>
                        </tr>
                      )
                    })}
                    {diagnostics.runningVersions
                      .filter(
                        (version) =>
                          !diagnostics.installations.some(
                            (installation) => installation.version === version,
                          ),
                      )
                      .map((version) => {
                        const runningServer = diagnostics.servers.find(
                          (server) =>
                            server.state === "healthy" && server.serverVersion === version,
                        )
                        return (
                          <tr key={`running-${version}`}>
                            <td>Location unavailable</td>
                            <td>
                              <code>{version}</code>
                            </td>
                            <td>
                              <strong className="diagnostics-status diagnostics-status--compatible">
                                Running (PID{" "}
                                {runningServer?.serverPid ??
                                  runningServer?.registeredPid ??
                                  "unknown"}
                                )
                              </strong>
                            </td>
                          </tr>
                        )
                      })}
                    {diagnostics.installations.length === 0 &&
                    diagnostics.runningVersions.length === 0 ? (
                      <tr>
                        <td>Not installed</td>
                        <td>Not available</td>
                        <td>
                          <strong className="diagnostics-status diagnostics-status--unavailable">
                            Not running
                          </strong>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}

            {diagnosticsError === undefined ? null : (
              <p className="settings-error" role="alert">
                {diagnosticsError}
              </p>
            )}
          </section>
        </div>
      </section>
    </div>,
    document.body,
  )
}
