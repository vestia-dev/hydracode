import { Effect, Fiber } from "effect"
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { BundledThemes, bundledThemeID, type BundledThemeID } from "../../../shared/theme"
import type { OpenCodeDiagnostics, OpenCodeServerDiagnostics } from "../../../shared/openCode"
import { AppRuntime } from "../runtime"
import { DesktopBridge } from "../services/DesktopBridge"
import { useTheme, useThemeUpdate } from "../theme"
import { IconButton } from "./IconButton"

const themeDescriptions: Record<BundledThemeID, string> = {
  "hydracode-dark": "Low-glare charcoal surfaces for focused work.",
  "hydracode-light": "Warm neutral surfaces with crisp contrast.",
}

const diagnosticStatus = (server: OpenCodeServerDiagnostics) => {
  if (server.state === "healthy") return "Healthy"
  if (server.state === "not-registered") return "Not registered"
  if (server.state === "invalid") return "Invalid registration"
  return "Unreachable"
}

const overallStatus = {
  healthy: "Ready",
  unavailable: "No healthy service",
} as const

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
          <section className="settings-section" aria-labelledby="opencode-title">
            <div className="settings-section__heading">
              <div>
                <h2 id="opencode-title">OpenCode</h2>
                <p>Installation and service diagnostics for the OpenCode client HydraCode uses.</p>
              </div>
              <div className="diagnostics-actions">
                {diagnostics?.installation.installed === false ? (
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
              <>
                <div className="diagnostics-summary">
                  <div>
                    <span>HydraCode status</span>
                    <strong
                      className={`diagnostics-status diagnostics-status--${diagnostics.status}`}
                    >
                      {overallStatus[diagnostics.status]}
                    </strong>
                  </div>
                  <div>
                    <span>OpenCode installation</span>
                    <strong>
                      {diagnostics.installation.installed ? "Installed" : "Not installed"}
                    </strong>
                  </div>
                  <div>
                    <span>Installed version</span>
                    <code>{diagnostics.installation.version ?? "Not available"}</code>
                  </div>
                </div>

                {diagnostics.installation.executable === undefined ? null : (
                  <p className="diagnostics-runtime-path">
                    Installed executable <code>{diagnostics.installation.executable}</code>
                  </p>
                )}

                <div className="diagnostics-servers">
                  {diagnostics.servers.map((server) => (
                    <article className="diagnostics-server" key={server.registrationFile}>
                      <header>
                        <div>
                          <h3>{server.source}</h3>
                          <code>{server.registrationFile}</code>
                        </div>
                        <span
                          className={`diagnostics-status diagnostics-status--${
                            server.state === "healthy" ? "compatible" : "unavailable"
                          }`}
                        >
                          {diagnosticStatus(server)}
                        </span>
                      </header>
                      <dl className="diagnostics-list">
                        <div>
                          <dt>Registered URL</dt>
                          <dd>{server.registeredUrl ?? "Not registered"}</dd>
                        </div>
                        <div>
                          <dt>Server version</dt>
                          <dd>
                            {server.serverVersion ?? server.registeredVersion ?? "Not reported"}
                          </dd>
                        </div>
                        <div>
                          <dt>Process ID</dt>
                          <dd>{server.serverPid ?? server.registeredPid ?? "Not reported"}</dd>
                        </div>
                        <div>
                          <dt>Authentication</dt>
                          <dd>
                            {server.authentication === "basic" ? "Basic auth configured" : "None"}
                          </dd>
                        </div>
                        <div>
                          <dt>Instance ID</dt>
                          <dd>{server.instanceID ?? "Not reported"}</dd>
                        </div>
                        <div>
                          <dt>Advertised URLs</dt>
                          <dd>
                            {server.advertisedUrls.length === 0
                              ? "None reported"
                              : server.advertisedUrls.join(", ")}
                          </dd>
                        </div>
                      </dl>
                      {server.error === undefined ? null : (
                        <p className="diagnostics-server__error">{server.error}</p>
                      )}
                    </article>
                  ))}
                </div>
              </>
            )}

            {diagnosticsError === undefined ? null : (
              <p className="settings-error" role="alert">
                {diagnosticsError}
              </p>
            )}
          </section>

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
        </div>
      </section>
    </div>,
    document.body,
  )
}
