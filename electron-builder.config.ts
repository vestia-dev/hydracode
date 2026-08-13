import type { Configuration } from "electron-builder"

const config: Configuration = {
  appId: "dev.vestia.hydracode",
  productName: "HydraCode",
  forceCodeSigning: process.env.HYDRACODE_REQUIRE_CODE_SIGNING === "true",
  artifactName: "HydraCode-${version}-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
  },
  files: ["out/**/*", "package.json"],
  extraResources: [
    {
      from: "THIRD_PARTY_NOTICES.txt",
      to: "THIRD_PARTY_NOTICES.txt",
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    hardenedRuntime: true,
    icon: "build/icon.png",
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
