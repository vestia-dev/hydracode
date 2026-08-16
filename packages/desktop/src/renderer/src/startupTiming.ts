const prefix = "hydracode:startup:"

export type StartupMark =
  | "renderer-start"
  | "launch-render-requested"
  | "launch-painted"
  | "theme-load-start"
  | "theme-ready"
  | "highlighter-load-start"
  | "highlighter-ready"
  | "app-render-requested"
  | "react-mounted"
  | "application-state-load-start"
  | "application-state-ready"
  | "project-catalog-load-start"
  | "project-catalog-ready"
  | "project-selection-ready"
  | "project-open-start"
  | "project-subscription-ready"
  | "project-snapshot-received"
  | "project-snapshot-projected"
  | "project-snapshot-ready"
  | "session-restoration-start"
  | "session-restoration-dispatched"
  | "session-selections-ready"
  | "session-restoration-ready"
  | "launch-completion-requested"
  | "launch-completion-committed"
  | "first-project-paint"

function entryName(name: StartupMark) {
  return `${prefix}${name}`
}

export function markStartup(name: StartupMark, detail?: Record<string, number | string>) {
  const fullName = entryName(name)
  if (performance.getEntriesByName(fullName, "mark").length === 0)
    performance.mark(fullName, detail === undefined ? undefined : { detail })
}

export function measureStartup(name: string, start: StartupMark, end: StartupMark) {
  const fullName = `${prefix}${name}`
  if (performance.getEntriesByName(fullName, "measure").length > 0) return
  performance.measure(fullName, entryName(start), entryName(end))
}

export function recordStartupMeasure(
  name: string,
  startTime: number,
  detail?: Record<string, number | string>,
) {
  if (performance.getEntriesByName(entryName("first-project-paint"), "mark").length > 0) return
  performance.measure(`${prefix}${name}`, {
    start: startTime,
    duration: performance.now() - startTime,
    ...(detail === undefined ? {} : { detail }),
  })
}

export function recordStartupDuration(
  name: string,
  startTime: number,
  duration: number,
  detail?: Record<string, number | string>,
) {
  if (performance.getEntriesByName(entryName("first-project-paint"), "mark").length > 0) return
  performance.measure(`${prefix}${name}`, {
    start: startTime,
    duration,
    ...(detail === undefined ? {} : { detail }),
  })
}

export function markStartupAfterPaint(
  name: StartupMark,
  summarize = false,
  measureFrom?: StartupMark,
) {
  let secondFrame: number | undefined
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => {
      markStartup(name)
      if (measureFrom !== undefined) measureStartup(`${measureFrom}-to-${name}`, measureFrom, name)
      if (summarize) logStartupSummary()
    })
  })
  return () => {
    window.cancelAnimationFrame(firstFrame)
    if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame)
  }
}

function logStartupSummary() {
  const start = performance.getEntriesByName(entryName("renderer-start"), "mark")[0]
  if (start === undefined) return
  const marks = performance
    .getEntriesByType("mark")
    .filter((entry) => entry.name.startsWith(prefix))
    .toSorted((left, right) => left.startTime - right.startTime)
  console.table(
    marks.map((entry, index) => ({
      milestone: entry.name.slice(prefix.length),
      "from renderer (ms)": Math.round((entry.startTime - start.startTime) * 10) / 10,
      "from previous (ms)":
        index === 0
          ? 0
          : Math.round((entry.startTime - (marks[index - 1]?.startTime ?? entry.startTime)) * 10) /
            10,
    })),
  )
}
