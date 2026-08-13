import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  type BundledThemeID,
  DefaultBundledThemeID,
  DefaultTheme,
  DefaultThemeSettings,
  findBundledTheme,
  HydraCodeLightTheme,
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
  readonly selectBundled: (id: BundledThemeID) => Effect.Effect<Theme, ThemeServiceError>
}

export class ThemeService extends Context.Service<ThemeService, ThemeServiceShape>()(
  "HydraCode/ThemeService",
) {}

interface ThemeServiceOptions {
  readonly configHome?: string
  readonly home?: string
}

const LegacyDefaultThemeID: ThemeID = "hydracode-light"
const { diff: _, ...LegacyHydraCodeLightTheme } = HydraCodeLightTheme

function isGeneratedLightTheme(theme: Theme) {
  const serialized = JSON.stringify(theme)
  return (
    serialized === JSON.stringify(HydraCodeLightTheme) ||
    serialized === JSON.stringify(LegacyHydraCodeLightTheme)
  )
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

      const writeSettings = (settings: ThemeSettings) =>
        fileSystem.writeFileString(paths.settings, `${JSON.stringify(settings, null, 2)}\n`)

      const load = Effect.gen(function* () {
        yield* fileSystem.makeDirectory(paths.themes, { recursive: true })

        if (!(yield* fileSystem.exists(paths.settings))) {
          yield* writeSettings(DefaultThemeSettings)
        }

        const settings = yield* fileSystem.readFileString(paths.settings).pipe(
          Effect.flatMap((source) =>
            Effect.try({
              try: () => JSON.parse(source) as unknown,
              catch: (cause) => cause,
            }),
          ),
          Effect.flatMap(Schema.decodeUnknownEffect(ThemeSettings)),
          Effect.catch(() => Effect.succeed(DefaultThemeSettings)),
        )
        if (settings.theme === undefined) return DefaultTheme

        const selectedThemeFile = paths.theme(settings.theme)
        if (settings.theme === LegacyDefaultThemeID) {
          const generatedTheme = yield* fileSystem.readFileString(selectedThemeFile).pipe(
            Effect.flatMap((source) =>
              Effect.try({
                try: () => JSON.parse(source) as unknown,
                catch: (cause) => cause,
              }),
            ),
            Effect.flatMap(Schema.decodeUnknownEffect(Theme)),
            Effect.map(isGeneratedLightTheme),
            Effect.catch(() => Effect.succeed(false)),
          )
          if (generatedTheme) {
            yield* writeSettings(DefaultThemeSettings)
            yield* fileSystem.remove(selectedThemeFile)
            return DefaultTheme
          }
        }

        const bundledTheme = findBundledTheme(settings.theme)
        if (bundledTheme !== undefined) return bundledTheme

        return yield* fileSystem.readFileString(selectedThemeFile).pipe(
          Effect.flatMap((source) =>
            Effect.try({
              try: () => JSON.parse(source) as unknown,
              catch: (cause) => cause,
            }),
          ),
          Effect.flatMap(Schema.decodeUnknownEffect(Theme)),
          Effect.catch(() => Effect.succeed(DefaultTheme)),
        )
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ThemeServiceError({
              message: `HydraCode could not load its theme configuration from ${paths.directory}.`,
              cause,
            }),
        ),
      )

      const selectBundled = (id: BundledThemeID) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(paths.themes, { recursive: true })
          yield* writeSettings(id === DefaultBundledThemeID ? DefaultThemeSettings : { theme: id })
          return findBundledTheme(id) ?? DefaultTheme
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ThemeServiceError({
                message: `HydraCode could not save its theme configuration to ${paths.directory}.`,
                cause,
              }),
          ),
        )

      return ThemeService.of({ load, selectBundled })
    }),
  )
}

export const ThemeServiceLive = makeThemeServiceLive(
  process.env.XDG_CONFIG_HOME === undefined ? {} : { configHome: process.env.XDG_CONFIG_HOME },
)
