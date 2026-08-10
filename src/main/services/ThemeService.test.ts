import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Effect } from "effect"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { DefaultTheme, DefaultThemeSettings } from "../../shared/theme"
import { makeThemeServiceLive, ThemeService, themePaths } from "./ThemeService"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "hydracode-theme-"))
  temporaryDirectories.push(directory)
  return directory
}

function loadTheme(configHome: string) {
  return Effect.runPromise(
    ThemeService.use((service) => service.load).pipe(
      Effect.provide(makeThemeServiceLive({ configHome })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
}

it("creates default settings and the built-in theme in the XDG config home", async () => {
  const configHome = await temporaryDirectory()
  const theme = await loadTheme(configHome)
  const paths = themePaths({ configHome })
  const storedSettings = JSON.parse(await readFile(paths.settings, "utf8"))
  const storedTheme = JSON.parse(await readFile(paths.theme(DefaultThemeSettings.theme), "utf8"))

  expect(theme).toEqual(DefaultTheme)
  expect(storedSettings).toEqual(DefaultThemeSettings)
  expect(storedTheme).toEqual(DefaultTheme)
})

it("loads the theme selected by its ID in settings", async () => {
  const configHome = await temporaryDirectory()
  await loadTheme(configHome)
  const paths = themePaths({ configHome })
  const customTheme = {
    ...DefaultTheme,
    name: "Test Theme",
    colors: { ...DefaultTheme.colors, background: "#000000" },
  }
  await writeFile(paths.theme("test-theme"), JSON.stringify(customTheme))
  await writeFile(paths.settings, JSON.stringify({ theme: "test-theme" }))

  await expect(loadTheme(configHome)).resolves.toEqual(customTheme)
})

it("keeps existing themes valid when they omit diff overrides", async () => {
  const configHome = await temporaryDirectory()
  await loadTheme(configHome)
  const paths = themePaths({ configHome })
  const { diff: _, ...existingTheme } = DefaultTheme
  await writeFile(paths.theme("existing-theme"), JSON.stringify(existingTheme))
  await writeFile(paths.settings, JSON.stringify({ theme: "existing-theme" }))

  await expect(loadTheme(configHome)).resolves.toEqual(existingTheme)
})

it("rejects an invalid theme without replacing it", async () => {
  const configHome = await temporaryDirectory()
  await loadTheme(configHome)
  const paths = themePaths({ configHome })
  const file = paths.theme(DefaultThemeSettings.theme)
  await writeFile(file, '{ "name": "Broken" }')

  await expect(loadTheme(configHome)).rejects.toMatchObject({ _tag: "ThemeServiceError" })
  await expect(readFile(file, "utf8")).resolves.toBe('{ "name": "Broken" }')
})

it("rejects a theme ID that could escape the themes directory", async () => {
  const configHome = await temporaryDirectory()
  await loadTheme(configHome)
  const paths = themePaths({ configHome })
  await writeFile(paths.settings, JSON.stringify({ theme: "../outside" }))

  await expect(loadTheme(configHome)).rejects.toMatchObject({ _tag: "ThemeServiceError" })
})
