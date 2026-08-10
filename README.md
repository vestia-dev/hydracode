# HydraCode

A visual desktop client for coding agents.

HydraCode presents each agent session as a live graph of inputs, outputs, tool calls, sources, files, and subagents. A desktop window represents one OpenCode project, and its active sessions are stacked vertically so they can be observed together across local checkouts and sandboxes.

## Development

```sh
bun install
bun run dev
```

## Themes

HydraCode stores its settings and themes under `$XDG_CONFIG_HOME/hydracode`. When
`XDG_CONFIG_HOME` is not set, it uses `~/.config/hydracode`.

On first launch it creates:

```text
hydracode/
  settings.json
  themes/
    hydracode-light.json
```

`settings.json` selects a theme by ID:

```json
{
  "theme": "hydracode-light"
}
```

Theme ID `hydracode-light` resolves to `themes/hydracode-light.json`. Theme IDs may contain
lowercase letters, numbers, and hyphens. Theme files use a deliberately small shared token set:

- Colors: background, surfaces, text, border, accent, statuses, and graph relationships.
- Radii: small, medium, large, and round.
- Shadows: subtle, raised, and focus.
- Typography: UI and monospace font families.
- Diff: light/dark syntax mode plus foreground, background, gutter, separator, addition, and deletion colors.
- Layout: horizontal and vertical node distance.

The optional `diff` group controls patch rendering. Existing themes that omit it use HydraCode's
readable light defaults. Set `themeType` to `dark` when supplying colors intended for dark syntax
highlighting; this keeps Pierre's syntax tokens and the configured diff background in the same mode.

Restart HydraCode after changing the selection or a theme file.

## Verification

```sh
bun run lint
bun run test
bun run build
```

## Distribution

The first supported release target is macOS on Apple Silicon. HydraCode packages the matching
OpenCode V2 runtime, checks for an existing OpenCode service first, and starts the bundled runtime
when no service is available.

Build an unpacked application locally:

```sh
bun run package:mac:dir
```

Build the DMG, update ZIP, and update metadata:

```sh
bun run package:mac
```

The packaged updater checks GitHub Releases on startup and every ten minutes. It downloads an
available update in the background and waits for the user to click the header button before
restarting and installing it. Updates are disabled in development builds.

### Publishing

The release workflow runs for tags matching `v*`. The tag must equal the `package.json` version,
for example `v0.1.0`. It requires these GitHub Actions secrets:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application certificate.
- `APPLE_CERTIFICATE_PASSWORD`: password for the certificate archive.
- `APPLE_API_KEY_CONTENT`: App Store Connect API private key contents.
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect API issuer ID.

The workflow signs and notarizes HydraCode, creates a GitHub Release, and uploads the DMG, ZIP,
blockmap, and `latest-mac.yml` metadata used by `electron-updater`.

### Future Platforms

Runtime selection and dependencies already cover macOS, Windows, and Linux on ARM64 and x64. Each
future platform must build on its native runner so only the matching optional OpenCode package is
installed and embedded.

| Platform          | Installer targets  | Signing/update requirement                           |
| ----------------- | ------------------ | ---------------------------------------------------- |
| macOS ARM64       | DMG and ZIP        | Developer ID signing and Apple notarization          |
| macOS x64         | DMG and ZIP        | Add an Intel macOS build job                         |
| Windows ARM64/x64 | NSIS               | Add Windows jobs and Azure Artifact Signing          |
| Linux ARM64/x64   | AppImage, DEB, RPM | Add Linux jobs; AppImage supports the in-app updater |

When multiple architectures are published for one platform, their generated `latest*.yml` files
must be merged so the update feed contains every architecture-specific artifact.
