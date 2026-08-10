import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Effect } from "effect"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import {
  DefaultTheme,
  DefaultThemeSettings,
  HydraCodeDarkTheme,
  HydraCodeLightTheme,
} from "../../shared/theme"
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

function selectBundledTheme(configHome: string, id: "hydracode-dark" | "hydracode-light") {
  return Effect.runPromise(
    ThemeService.use((service) => service.selectBundled(id)).pipe(
      Effect.provide(makeThemeServiceLive({ configHome })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
}

it("creates empty default settings without copying bundled themes", async () => {
  const configHome = await temporaryDirectory()
  const theme = await loadTheme(configHome)
  const paths = themePaths({ configHome })
  const storedSettings = JSON.parse(await readFile(paths.settings, "utf8"))

  expect(theme).toEqual(HydraCodeDarkTheme)
  expect(storedSettings).toEqual(DefaultThemeSettings)
  expect(await readdir(paths.themes)).toEqual([])
  expect(HydraCodeLightTheme.name).toBe("HydraCode Light")
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

it.each([
  ["current", HydraCodeLightTheme],
  ["legacy", (({ diff: _, ...theme }) => theme)(HydraCodeLightTheme)],
])(
  "migrates the %s generated light theme to the bundled dark default",
  async (_, generatedTheme) => {
    const configHome = await temporaryDirectory()
    await loadTheme(configHome)
    const paths = themePaths({ configHome })
    const file = paths.theme("hydracode-light")
    await writeFile(file, JSON.stringify(generatedTheme))
    await writeFile(paths.settings, JSON.stringify({ theme: "hydracode-light" }))

    await expect(loadTheme(configHome)).resolves.toEqual(HydraCodeDarkTheme)
    await expect(readFile(paths.settings, "utf8").then(JSON.parse)).resolves.toEqual({})
    await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  },
)

it("reserves bundled theme IDs without deleting a conflicting custom file", async () => {
  const configHome = await temporaryDirectory()
  await loadTheme(configHome)
  const paths = themePaths({ configHome })
  const customTheme = { ...HydraCodeLightTheme, name: "Customized Light" }
  const file = paths.theme("hydracode-light")
  await writeFile(file, JSON.stringify(customTheme))
  await writeFile(paths.settings, JSON.stringify({ theme: "hydracode-light" }))

  await expect(loadTheme(configHome)).resolves.toEqual(HydraCodeLightTheme)
  await expect(readFile(file, "utf8")).resolves.toBe(JSON.stringify(customTheme))
})

it("selects bundled themes without copying them into the user theme directory", async () => {
  const configHome = await temporaryDirectory()
  const paths = themePaths({ configHome })

  await expect(selectBundledTheme(configHome, "hydracode-light")).resolves.toEqual(
    HydraCodeLightTheme,
  )
  await expect(readFile(paths.settings, "utf8").then(JSON.parse)).resolves.toEqual({
    theme: "hydracode-light",
  })
  await expect(readdir(paths.themes)).resolves.toEqual([])
  await expect(loadTheme(configHome)).resolves.toEqual(HydraCodeLightTheme)

  await expect(selectBundledTheme(configHome, "hydracode-dark")).resolves.toEqual(
    HydraCodeDarkTheme,
  )
  await expect(readFile(paths.settings, "utf8").then(JSON.parse)).resolves.toEqual({})
  await expect(loadTheme(configHome)).resolves.toEqual(HydraCodeDarkTheme)
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

it("falls back to the bundled dark theme for an invalid custom theme", async () => {
  const configHome = await temporaryDirectory()
  await loadTheme(configHome)
  const paths = themePaths({ configHome })
  const file = paths.theme("broken-theme")
  await writeFile(file, '{ "name": "Broken" }')
  await writeFile(paths.settings, JSON.stringify({ theme: "broken-theme" }))

  await expect(loadTheme(configHome)).resolves.toEqual(HydraCodeDarkTheme)
  await expect(readFile(file, "utf8")).resolves.toBe('{ "name": "Broken" }')
})

it("falls back to the bundled dark theme when the selected theme does not exist", async () => {
  const configHome = await temporaryDirectory()
  await loadTheme(configHome)
  const paths = themePaths({ configHome })
  await writeFile(paths.settings, JSON.stringify({ theme: "missing-theme" }))

  await expect(loadTheme(configHome)).resolves.toEqual(HydraCodeDarkTheme)
})

it("falls back to the bundled dark theme for an invalid theme ID", async () => {
  const configHome = await temporaryDirectory()
  await loadTheme(configHome)
  const paths = themePaths({ configHome })
  await writeFile(paths.settings, JSON.stringify({ theme: "../outside" }))

  await expect(loadTheme(configHome)).resolves.toEqual(HydraCodeDarkTheme)
})

it("falls back to the bundled dark theme for malformed settings", async () => {
  const configHome = await temporaryDirectory()
  await loadTheme(configHome)
  const paths = themePaths({ configHome })
  await writeFile(paths.settings, "not json")

  await expect(loadTheme(configHome)).resolves.toEqual(HydraCodeDarkTheme)
})
