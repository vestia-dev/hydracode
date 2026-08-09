# HydraCode

A visual desktop client for coding agents.

HydraCode presents each agent session as a live graph of inputs, outputs, tool calls, sources, files, and subagents. A desktop window represents one workspace, and its active sessions are stacked vertically so they can be observed together.

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
