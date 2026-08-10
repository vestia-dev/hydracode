import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { DesktopServiceLive } from "./services/DesktopService"
import { OpenCodeServiceLive } from "./services/OpenCodeService"
import { ThemeServiceLive } from "./services/ThemeService"
import { UpdateServiceLive } from "./services/UpdateService"
import { ProjectRegistryLive } from "./services/ProjectRegistry"

const OpenCodeLayer = OpenCodeServiceLive.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(FetchHttpClient.layer),
)
const ThemeLayer = ThemeServiceLive.pipe(Layer.provide(NodeFileSystem.layer))
const RegistryLayer = ProjectRegistryLive.pipe(Layer.provide(OpenCodeLayer))
const MainLayer = Layer.mergeAll(
  DesktopServiceLive,
  OpenCodeLayer,
  ThemeLayer,
  UpdateServiceLive,
  RegistryLayer,
)

export const MainRuntime = ManagedRuntime.make(MainLayer)
