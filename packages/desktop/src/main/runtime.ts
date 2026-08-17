import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { DesktopServiceLive } from "./services/DesktopService"
import { OpenCodeServiceLive } from "./services/OpenCodeService"
import { ThemeServiceLive } from "./services/ThemeService"
import { UpdateServiceLive } from "./services/UpdateService"
import { ProjectRegistryLive } from "./services/ProjectRegistry"
import { ApplicationStateServiceLive } from "./services/ApplicationStateService"
import { OpenCodeEventServiceLive } from "./services/OpenCodeEventService"

const OpenCodeLayer = OpenCodeServiceLive.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(FetchHttpClient.layer),
)
const ThemeLayer = ThemeServiceLive.pipe(Layer.provide(NodeFileSystem.layer))
const ApplicationStateLayer = ApplicationStateServiceLive.pipe(Layer.provide(NodeFileSystem.layer))
const OpenCodeEventLayer = OpenCodeEventServiceLive.pipe(Layer.provide(OpenCodeLayer))
const RegistryLayer = ProjectRegistryLive.pipe(
  Layer.provide(Layer.merge(OpenCodeLayer, OpenCodeEventLayer)),
)
const MainLayer = Layer.mergeAll(
  DesktopServiceLive,
  OpenCodeLayer,
  ThemeLayer,
  ApplicationStateLayer,
  UpdateServiceLive,
  RegistryLayer,
)

export const MainRuntime = ManagedRuntime.make(MainLayer)
