import { createContext, useContext } from "react"
import { DefaultDiffTheme, DefaultTheme, type Theme } from "../../shared/theme"

export const ThemeContext = createContext<Theme>(DefaultTheme)

export function useTheme() {
  return useContext(ThemeContext)
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme.name

  for (const [name, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--color-${name}`, value)
  }
  for (const [name, value] of Object.entries(theme.radii)) {
    root.style.setProperty(`--radius-${name}`, value)
  }
  for (const [name, value] of Object.entries(theme.shadows)) {
    root.style.setProperty(`--shadow-${name}`, value)
  }
  for (const [name, value] of Object.entries(theme.typography)) {
    root.style.setProperty(`--typography-${name}`, value)
  }
  for (const [name, value] of Object.entries(theme.diff ?? DefaultDiffTheme)) {
    root.style.setProperty(`--diff-${name}`, value)
  }
}
