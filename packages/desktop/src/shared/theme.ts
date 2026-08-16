import { Schema } from "effect"

export const ThemeID = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/))
export type ThemeID = typeof ThemeID.Type

export const BundledThemeID = Schema.Literals(["hydracode-dark", "hydracode-light"])
export type BundledThemeID = typeof BundledThemeID.Type

export const SetBundledThemeCommand = Schema.Struct({
  theme: BundledThemeID,
})
export type SetBundledThemeCommand = typeof SetBundledThemeCommand.Type

export const ThemeSettings = Schema.Struct({
  theme: Schema.optional(ThemeID),
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

export const DefaultThemeSettings: ThemeSettings = {}

export const HydraCodeLightDiffTheme: NonNullable<Theme["diff"]> = {
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

export const HydraCodeDarkDiffTheme: NonNullable<Theme["diff"]> = {
  themeType: "dark",
  background: "#1b1b1a",
  foreground: "#deded8",
  lineNumber: "#777771",
  contextBackground: "#20201f",
  gutterBackground: "#181817",
  separatorBackground: "#2a2a28",
  addition: "#7bc294",
  deletion: "#df8580",
  additionBackground: "#1d3527",
  deletionBackground: "#3b2322",
}

export const HydraCodeLightTheme: Theme = {
  name: "HydraCode Light",
  colors: {
    background: "#f7f7f5",
    surface: "#ffffff",
    surfaceMuted: "#fafaf8",
    text: "#20201e",
    textMuted: "#777771",
    border: "#deded8",
    accent: "#809B75",
    accentText: "#20201e",
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
    focus: "0 0 0 2px rgb(128 155 117 / 10%)",
  },
  typography: {
    uiFontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    monoFontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  diff: HydraCodeLightDiffTheme,
  layout: {
    nodeDistance: {
      horizontal: 32,
      vertical: 24,
    },
  },
}

export const HydraCodeDarkTheme: Theme = {
  name: "HydraCode Dark",
  colors: {
    background: "#171716",
    surface: "#20201f",
    surfaceMuted: "#262624",
    text: "#e8e8e3",
    textMuted: "#9a9a93",
    border: "#383835",
    accent: "#809B75",
    accentText: "#101722",
    success: "#68b989",
    danger: "#d27670",
    read: "#7ea8c2",
    write: "#d29a5d",
    grid: "#30302e",
    edge: "#555550",
  },
  radii: {
    small: "5px",
    medium: "8px",
    large: "12px",
    round: "9999px",
  },
  shadows: {
    subtle: "0 1px 2px rgb(0 0 0 / 24%)",
    raised: "0 2px 10px rgb(0 0 0 / 30%)",
    focus: "0 0 0 2px rgb(128 155 117 / 20%)",
  },
  typography: {
    uiFontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    monoFontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  diff: HydraCodeDarkDiffTheme,
  layout: {
    nodeDistance: {
      horizontal: 32,
      vertical: 24,
    },
  },
}

export const DefaultBundledThemeID: BundledThemeID = "hydracode-dark"
export const BundledThemes: ReadonlyArray<{
  readonly id: BundledThemeID
  readonly theme: Theme
}> = [
  { id: DefaultBundledThemeID, theme: HydraCodeDarkTheme },
  { id: "hydracode-light", theme: HydraCodeLightTheme },
]

export function findBundledTheme(id: ThemeID) {
  return BundledThemes.find((entry) => entry.id === id)?.theme
}

export function bundledThemeID(theme: Theme) {
  const serialized = JSON.stringify(theme)
  return BundledThemes.find((entry) => JSON.stringify(entry.theme) === serialized)?.id
}

export const DefaultDiffTheme = HydraCodeDarkDiffTheme
export const DefaultTheme = HydraCodeDarkTheme
