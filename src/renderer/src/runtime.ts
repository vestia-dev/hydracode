import { Layer, ManagedRuntime } from "effect"
import { DesktopBridgeLive } from "./services/DesktopBridge"
import { MarkdownRendererLive } from "./services/MarkdownRenderer"

const RendererLayer = Layer.mergeAll(DesktopBridgeLive, MarkdownRendererLive)

export const AppRuntime = ManagedRuntime.make(RendererLayer)
