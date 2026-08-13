import DOMPurify, { type Config } from "dompurify"
import { Marked } from "marked"
import { Context, Effect, Layer, Schema } from "effect"

const MAX_CACHE_ENTRIES = 200

const sanitizeConfig: Config = {
  USE_PROFILES: { html: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style", "script"],
  FORBID_CONTENTS: ["style", "script"],
  FORBID_ATTR: ["style"],
  ADD_ATTR: ["target"],
}

export class MarkdownRenderError extends Schema.TaggedErrorClass<MarkdownRenderError>()(
  "MarkdownRenderError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

interface MarkdownRendererShape {
  readonly render: (source: string) => Effect.Effect<string, MarkdownRenderError>
}

export class MarkdownRenderer extends Context.Service<MarkdownRenderer, MarkdownRendererShape>()(
  "HydraCode/MarkdownRenderer",
) {}

export const MarkdownRendererLive = Layer.sync(MarkdownRenderer, () => {
  const parser = new Marked({
    gfm: true,
    renderer: {
      link: ({ href, text, title }) => {
        const titleAttribute = title === null ? "" : ` title="${title}"`
        return `<a href="${href}"${titleAttribute} target="_blank" rel="noopener noreferrer">${text}</a>`
      },
    },
  })
  const cache = new Map<string, string>()

  const remember = (source: string, html: string) => {
    cache.delete(source)
    cache.set(source, html)
    if (cache.size <= MAX_CACHE_ENTRIES) return
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }

  const render = Effect.fn("MarkdownRenderer.render")((source: string) => {
    const cached = cache.get(source)
    if (cached !== undefined) {
      remember(source, cached)
      return Effect.succeed(cached)
    }

    return Effect.try({
      try: () => {
        const html = DOMPurify.sanitize(parser.parse(source, { async: false }), sanitizeConfig)
        remember(source, html)
        return html
      },
      catch: (cause) =>
        new MarkdownRenderError({
          message: "HydraCode could not render this Markdown content.",
          cause,
        }),
    })
  })

  return MarkdownRenderer.of({ render })
})

export const renderMarkdown = (source: string) =>
  MarkdownRenderer.use((renderer) => renderer.render(source))
