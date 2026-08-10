import { useState } from "react"
import { BundledThemes, bundledThemeID, type BundledThemeID } from "../../../shared/theme"
import { AppRuntime } from "../runtime"
import { DesktopBridge } from "../services/DesktopBridge"
import { useTheme, useThemeUpdate } from "../theme"

const themeDescriptions: Record<BundledThemeID, string> = {
  "hydracode-dark": "Low-glare charcoal surfaces for focused work.",
  "hydracode-light": "Warm neutral surfaces with crisp contrast.",
}

export function SettingsPage() {
  const theme = useTheme()
  const updateTheme = useThemeUpdate()
  const [saving, setSaving] = useState<BundledThemeID>()
  const [error, setError] = useState<string>()
  const selectedTheme = bundledThemeID(theme)

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

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="settings-page__content">
        <header className="settings-page__header">
          <p className="settings-page__eyebrow">HydraCode</p>
          <h1 id="settings-title">Settings</h1>
          <p>Choose how the workspace looks and feels.</p>
        </header>

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
  )
}
