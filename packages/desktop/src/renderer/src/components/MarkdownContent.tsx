import { memo, useDeferredValue, useMemo } from "react"
import { Effect } from "effect"
import { AppRuntime } from "../runtime"
import { renderMarkdown } from "../services/MarkdownRenderer"

interface MarkdownContentProps {
  readonly className?: string
  readonly source: string
}

export const MarkdownContent = memo(function MarkdownContent({
  className,
  source,
}: MarkdownContentProps) {
  const deferredSource = useDeferredValue(source)
  const rendered = useMemo(
    () =>
      AppRuntime.runSync(
        renderMarkdown(deferredSource).pipe(
          Effect.map((html) => ({ _tag: "Rendered" as const, html })),
          Effect.catch((error) =>
            Effect.succeed({ _tag: "PlainText" as const, message: error.message }),
          ),
        ),
      ),
    [deferredSource],
  )
  const classes = ["markdown-content", "nodrag", "nopan", className]
    .filter((value) => value !== undefined)
    .join(" ")

  if (rendered._tag === "PlainText") {
    return (
      <div className={`${classes} markdown-content--fallback`} title={rendered.message}>
        {deferredSource}
      </div>
    )
  }

  return <div className={classes} dangerouslySetInnerHTML={{ __html: rendered.html }} />
})
