import { NodeFileSystem } from "@effect/platform-node"
import { Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { DesktopServiceLive } from "./services/DesktopService"
import { OpenCodeServiceLive } from "./services/OpenCodeService"
import { ThemeServiceLive } from "./services/ThemeService"
import { WorkspaceRegistryLive } from "./services/WorkspaceRegistry"

const OpenCodeLayer = OpenCodeServiceLive.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(FetchHttpClient.layer),
)
const ThemeLayer = ThemeServiceLive.pipe(Layer.provide(NodeFileSystem.layer))
const RegistryLayer = WorkspaceRegistryLive.pipe(Layer.provide(OpenCodeLayer))
const MainLayer = Layer.mergeAll(DesktopServiceLive, OpenCodeLayer, ThemeLayer, RegistryLayer)

export const MainRuntime = ManagedRuntime.make(MainLayer)
