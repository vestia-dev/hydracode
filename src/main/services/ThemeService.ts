import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  DefaultTheme,
  DefaultThemeID,
  DefaultThemeSettings,
  Theme,
  type ThemeID,
  ThemeSettings,
} from "../../shared/theme"

export class ThemeServiceError extends Schema.TaggedErrorClass<ThemeServiceError>()(
  "ThemeServiceError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

interface ThemeServiceShape {
  readonly load: Effect.Effect<Theme, ThemeServiceError>
}

export class ThemeService extends Context.Service<ThemeService, ThemeServiceShape>()(
  "HydraCode/ThemeService",
) {}

interface ThemeServiceOptions {
  readonly configHome?: string
  readonly home?: string
}

export function themePaths(options: ThemeServiceOptions = {}) {
  const configHome = options.configHome || join(options.home ?? homedir(), ".config")
  const directory = join(configHome, "hydracode")
  const themes = join(directory, "themes")
  return {
    directory,
    settings: join(directory, "settings.json"),
    themes,
    theme: (id: ThemeID) => join(themes, `${id}.json`),
  }
}

export function makeThemeServiceLive(options: ThemeServiceOptions = {}) {
  return Layer.effect(
    ThemeService,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const paths = themePaths(options)

      const load = Effect.gen(function* () {
        yield* fileSystem.makeDirectory(paths.themes, { recursive: true })

        if (!(yield* fileSystem.exists(paths.settings))) {
          yield* fileSystem.writeFileString(
            paths.settings,
            `${JSON.stringify(DefaultThemeSettings, null, 2)}\n`,
          )
        }

        const defaultThemeFile = paths.theme(DefaultThemeID)
        if (!(yield* fileSystem.exists(defaultThemeFile))) {
          yield* fileSystem.writeFileString(
            defaultThemeFile,
            `${JSON.stringify(DefaultTheme, null, 2)}\n`,
          )
        }

        const settingsSource = yield* fileSystem.readFileString(paths.settings)
        const settingsValue = yield* Effect.try({
          try: () => JSON.parse(settingsSource) as unknown,
          catch: (cause) => cause,
        })
        const settings = yield* Schema.decodeUnknownEffect(ThemeSettings)(settingsValue)
        const selectedThemeFile = paths.theme(settings.theme)
        const themeSource = yield* fileSystem.readFileString(selectedThemeFile)
        const themeValue = yield* Effect.try({
          try: () => JSON.parse(themeSource) as unknown,
          catch: (cause) => cause,
        })
        return yield* Schema.decodeUnknownEffect(Theme)(themeValue)
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ThemeServiceError({
              message: `HydraCode could not load its theme configuration from ${paths.directory}.`,
              cause,
            }),
        ),
      )

      return ThemeService.of({ load })
    }),
  )
}

export const ThemeServiceLive = makeThemeServiceLive(
  process.env.XDG_CONFIG_HOME === undefined ? {} : { configHome: process.env.XDG_CONFIG_HOME },
)
