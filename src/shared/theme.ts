import { Schema } from "effect"

export const ThemeID = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/))
export type ThemeID = typeof ThemeID.Type

export const ThemeSettings = Schema.Struct({
  theme: ThemeID,
})
export type ThemeSettings = typeof ThemeSettings.Type

const NodeDistance = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

export const Theme = Schema.Struct({
  name: Schema.String,
  colors: Schema.Struct({
    background: Schema.String,
    surface: Schema.String,
    surfaceMuted: Schema.String,
    text: Schema.String,
    textMuted: Schema.String,
    border: Schema.String,
    accent: Schema.String,
    accentText: Schema.String,
    success: Schema.String,
    danger: Schema.String,
    read: Schema.String,
    write: Schema.String,
    grid: Schema.String,
    edge: Schema.String,
  }),
  radii: Schema.Struct({
    small: Schema.String,
    medium: Schema.String,
    large: Schema.String,
    round: Schema.String,
  }),
  shadows: Schema.Struct({
    subtle: Schema.String,
    raised: Schema.String,
    focus: Schema.String,
  }),
  typography: Schema.Struct({
    uiFontFamily: Schema.String,
    monoFontFamily: Schema.String,
  }),
  diff: Schema.optional(
    Schema.Struct({
      themeType: Schema.Literals(["light", "dark"]),
      background: Schema.String,
      foreground: Schema.String,
      lineNumber: Schema.String,
      contextBackground: Schema.String,
      gutterBackground: Schema.String,
      separatorBackground: Schema.String,
      addition: Schema.String,
      deletion: Schema.String,
      additionBackground: Schema.String,
      deletionBackground: Schema.String,
    }),
  ),
  layout: Schema.Struct({
    nodeDistance: Schema.Struct({
      horizontal: NodeDistance,
      vertical: NodeDistance,
    }),
  }),
})
export type Theme = typeof Theme.Type

export const DefaultThemeID: ThemeID = "hydracode-light"
export const DefaultThemeSettings: ThemeSettings = { theme: DefaultThemeID }

export const DefaultDiffTheme: NonNullable<Theme["diff"]> = {
  themeType: "light",
  background: "#f5f5f2",
  foreground: "#292925",
  lineNumber: "#85857e",
  contextBackground: "#fafaf8",
  gutterBackground: "#efefeb",
  separatorBackground: "#e8e8e3",
  addition: "#287a4b",
  deletion: "#a3403b",
  additionBackground: "#e5f3e9",
  deletionBackground: "#f8e7e5",
}

export const DefaultTheme: Theme = {
  name: "HydraCode Light",
  colors: {
    background: "#f7f7f5",
    surface: "#ffffff",
    surfaceMuted: "#fafaf8",
    text: "#20201e",
    textMuted: "#777771",
    border: "#deded8",
    accent: "#507dbb",
    accentText: "#ffffff",
    success: "#4d9f70",
    danger: "#a34e48",
    read: "#688ca4",
    write: "#c08342",
    grid: "#d8d8d3",
    edge: "#b8b8b1",
  },
  radii: {
    small: "5px",
    medium: "8px",
    large: "12px",
    round: "9999px",
  },
  shadows: {
    subtle: "0 1px 2px rgb(32 32 30 / 6%)",
    raised: "0 2px 8px rgb(32 32 30 / 6%)",
    focus: "0 0 0 2px rgb(80 125 187 / 10%)",
  },
  typography: {
    uiFontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    monoFontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  diff: DefaultDiffTheme,
  layout: {
    nodeDistance: {
      horizontal: 32,
      vertical: 24,
    },
  },
}
