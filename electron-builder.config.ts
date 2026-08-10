import { join } from "node:path"
import type { Configuration } from "electron-builder"
import { openCodeRuntimeTarget } from "./src/main/services/openCodeRuntime"

const runtime = openCodeRuntimeTarget(process.platform, process.arch)

if (runtime === undefined) {
  throw new Error(
    `HydraCode cannot package an OpenCode runtime for ${process.platform}/${process.arch}`,
  )
}

const config: Configuration = {
  appId: "dev.vestia.hydracode",
  productName: "HydraCode",
  forceCodeSigning: process.env.HYDRACODE_REQUIRE_CODE_SIGNING === "true",
  artifactName: "HydraCode-${version}-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
  },
  files: ["out/**/*", "package.json", "!node_modules/@opencode-ai/cli-*/**/*"],
  extraResources: [
    {
      from: join("node_modules", runtime.packageName, "bin", runtime.executableName),
      to: join("opencode", runtime.executableName),
    },
    {
      from: "THIRD_PARTY_NOTICES.txt",
      to: "THIRD_PARTY_NOTICES.txt",
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    hardenedRuntime: true,
    target: ["dmg", "zip"],
    notarize: process.env.APPLE_API_KEY !== undefined,
  },
  dmg: {
    sign: true,
  },
  win: {
    target: ["nsis"],
  },
  nsis: {
    oneClick: true,
    perMachine: false,
  },
  linux: {
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
  publish: {
    provider: "github",
    owner: "vestia-dev",
    repo: "hydracode",
    channel: "latest",
  },
}

export default config
