export type CommandMenuCommandID =
  | "new-session"
  | "open-project"
  | "save-prompt"
  | "view-saved-prompts"
  | "toggle-settings"
  | "split-pane-right"
  | "split-pane-down"
  | "split-pane-left"
  | "split-pane-up"
  | "focus-pane-left"
  | "focus-pane-down"
  | "focus-pane-up"
  | "focus-pane-right"
  | "focus-prompt"
  | "follow-latest-node"
  | "close-pane"

export interface CommandMenuDefinition {
  readonly id: CommandMenuCommandID
  readonly title: string
  readonly category: "Application" | "Prompts" | "Layout" | "Pane" | "Navigation"
  readonly shortcut?: string
  readonly keywords: ReadonlyArray<string>
}

export const CommandMenuDefinitions: ReadonlyArray<CommandMenuDefinition> = [
  {
    id: "new-session",
    title: "New Session",
    category: "Application",
    keywords: ["create", "agent", "chat"],
  },
  {
    id: "open-project",
    title: "Open Project",
    category: "Application",
    keywords: ["open", "choose", "folder", "project list"],
  },
  {
    id: "save-prompt",
    title: "Save a Prompt",
    category: "Prompts",
    keywords: ["remember", "store", "later"],
  },
  {
    id: "view-saved-prompts",
    title: "View Saved Prompts",
    category: "Prompts",
    keywords: ["search", "browse", "copy", "clipboard"],
  },
  {
    id: "toggle-settings",
    title: "Open Settings",
    category: "Application",
    shortcut: "Mod+,",
    keywords: ["appearance", "theme", "preferences"],
  },
  {
    id: "split-pane-right",
    title: "Split Pane Right",
    category: "Pane",
    shortcut: "Mod+D",
    keywords: ["horizontal", "column", "new pane"],
  },
  {
    id: "split-pane-down",
    title: "Split Pane Down",
    category: "Pane",
    shortcut: "Mod+Shift+D",
    keywords: ["vertical", "row", "new pane"],
  },
  {
    id: "split-pane-left",
    title: "Split Pane Left",
    category: "Pane",
    keywords: ["horizontal", "column", "new pane"],
  },
  {
    id: "split-pane-up",
    title: "Split Pane Up",
    category: "Pane",
    keywords: ["vertical", "row", "new pane"],
  },
  {
    id: "focus-pane-left",
    title: "Focus Pane Left",
    category: "Navigation",
    shortcut: "Mod+Shift+Left",
    keywords: ["select", "move", "h"],
  },
  {
    id: "focus-pane-down",
    title: "Focus Pane Down",
    category: "Navigation",
    shortcut: "Mod+Shift+Down",
    keywords: ["select", "move", "j"],
  },
  {
    id: "focus-pane-up",
    title: "Focus Pane Up",
    category: "Navigation",
    shortcut: "Mod+Shift+Up",
    keywords: ["select", "move", "k"],
  },
  {
    id: "focus-pane-right",
    title: "Focus Pane Right",
    category: "Navigation",
    shortcut: "Mod+Shift+Right",
    keywords: ["select", "move", "l"],
  },
  {
    id: "focus-prompt",
    title: "Focus Prompt",
    category: "Navigation",
    shortcut: "Mod+I",
    keywords: ["input", "composer", "message"],
  },
  {
    id: "follow-latest-node",
    title: "Follow Latest Node",
    category: "Navigation",
    shortcut: "Mod+E",
    keywords: ["focus", "center", "graph", "activity"],
  },
  {
    id: "close-pane",
    title: "Close Pane",
    category: "Pane",
    shortcut: "Mod+W",
    keywords: ["remove", "delete"],
  },
]

export function filterCommandMenuDefinitions(query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  if (terms.length === 0) return CommandMenuDefinitions

  return CommandMenuDefinitions.filter((command) => {
    const searchable = [command.title, command.category, ...command.keywords]
      .join(" ")
      .toLocaleLowerCase()
    return terms.every((term) => searchable.includes(term))
  })
}
