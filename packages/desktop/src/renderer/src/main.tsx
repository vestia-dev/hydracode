import { Effect } from "effect"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { preloadHighlighter } from "@pierre/diffs"
import { DefaultTheme } from "../../shared/theme"
import { App } from "./App"
import { LaunchScreen } from "./components/LaunchScreen"
import { AppRuntime } from "./runtime"
import { DesktopBridge } from "./services/DesktopBridge"
import { markStartup, markStartupAfterPaint, measureStartup } from "./startupTiming"
import { applyTheme, ThemeContext } from "./theme"
import type { Theme } from "../../shared/theme"
import "@xyflow/react/dist/style.css"
import "./styles.css"

markStartup("renderer-start")

if (navigator.userAgent.includes("Mac")) {
  document.documentElement.dataset.platform = "macos"
}

const root = document.getElementById("root")

if (root === null) {
  throw new Error("HydraCode could not find the application root")
}

const reactRoot = createRoot(root)

applyTheme(DefaultTheme)
reactRoot.render(<LaunchScreen />)
markStartup("launch-render-requested")
markStartupAfterPaint("launch-painted")

markStartup("theme-load-start")
const theme = await AppRuntime.runPromise(
  DesktopBridge.use((desktop) => desktop.loadTheme).pipe(
    Effect.catch(() => Effect.succeed(DefaultTheme)),
  ),
)
applyTheme(theme)
markStartup("theme-ready")
measureStartup("theme-load", "theme-load-start", "theme-ready")

function HydraCodeRoot({ initialTheme }: { readonly initialTheme: Theme }) {
  const [currentTheme, setCurrentTheme] = useState(initialTheme)
  const updateTheme = (nextTheme: Theme) => {
    applyTheme(nextTheme)
    setCurrentTheme(nextTheme)
  }

  return (
    <ThemeContext value={{ theme: currentTheme, updateTheme }}>
      <App />
    </ThemeContext>
  )
}

markStartup("highlighter-load-start")
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
markStartup("highlighter-ready")
measureStartup("highlighter-load", "highlighter-load-start", "highlighter-ready")

reactRoot.render(
  <StrictMode>
    <HydraCodeRoot initialTheme={theme} />
  </StrictMode>,
)
markStartup("app-render-requested")

window.addEventListener("beforeunload", () => {
  void AppRuntime.dispose()
})
