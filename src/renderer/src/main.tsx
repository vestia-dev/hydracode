import { Effect } from "effect"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { preloadHighlighter } from "@pierre/diffs"
import { DefaultTheme } from "../../shared/theme"
import { App } from "./App"
import { AppRuntime } from "./runtime"
import { DesktopBridge } from "./services/DesktopBridge"
import { applyTheme, ThemeContext, ThemeUpdateContext } from "./theme"
import type { Theme } from "../../shared/theme"
import "@xyflow/react/dist/style.css"
import "./styles.css"

if (navigator.userAgent.includes("Mac")) {
  document.documentElement.dataset.platform = "macos"
}

const root = document.getElementById("root")

if (root === null) {
  throw new Error("HydraCode could not find the application root")
}

const theme = await AppRuntime.runPromise(
  DesktopBridge.use((desktop) => desktop.loadTheme).pipe(
    Effect.catch(() => Effect.succeed(DefaultTheme)),
  ),
)
applyTheme(theme)

function HydraCodeRoot({ initialTheme }: { readonly initialTheme: Theme }) {
  const [currentTheme, setCurrentTheme] = useState(initialTheme)
  const updateTheme = (nextTheme: Theme) => {
    applyTheme(nextTheme)
    setCurrentTheme(nextTheme)
  }

  return (
    <ThemeUpdateContext value={updateTheme}>
      <ThemeContext value={currentTheme}>
        <App />
      </ThemeContext>
    </ThemeUpdateContext>
  )
}

await AppRuntime.runPromise(
  Effect.tryPromise({
    try: () =>
      preloadHighlighter({
        themes: ["pierre-light", "pierre-dark"],
        langs: ["text"],
      }),
    catch: () => new Error("Pierre diff themes could not be loaded"),
  }).pipe(Effect.catch(() => Effect.void)),
)

createRoot(root).render(
  <StrictMode>
    <HydraCodeRoot initialTheme={theme} />
  </StrictMode>,
)

window.addEventListener("beforeunload", () => {
  void AppRuntime.dispose()
})
