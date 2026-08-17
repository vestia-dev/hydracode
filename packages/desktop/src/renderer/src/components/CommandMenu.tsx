import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Project, type Location } from "@opencode-ai/client/effect"
import { filterCommandMenuDefinitions, type CommandMenuCommandID } from "../domain/commandMenu"
import type { ProjectCatalogEntry } from "../../../shared/project"
import { projectCatalogMatches } from "../../../shared/domain/projectCatalog"
import { projectDisplayName, projectInitial } from "../domain/projectPresentation"
import type { SavedPrompt } from "../../../shared/savedPrompt"

export interface CommandMenuCommand {
  readonly id: CommandMenuCommandID
  readonly run: () => void
  readonly disabled?: boolean
}

interface CommandMenuProps {
  readonly commands: ReadonlyArray<CommandMenuCommand>
  readonly close: () => void
  readonly projects: ReadonlyArray<ProjectCatalogEntry>
  readonly projectsLoading: boolean
  readonly projectsError?: string | undefined
  readonly chooseFolder: () => void
  readonly openProject: (
    project: ProjectCatalogEntry,
    persist?: boolean,
    location?: Location.Ref,
  ) => void
  readonly listSavedPrompts: () => Promise<ReadonlyArray<SavedPrompt>>
  readonly savePrompt: (text: string) => Promise<void>
  readonly copyPrompt: (text: string) => Promise<void>
}

type CommandMenuView = "commands" | "projects" | "save-prompt" | "saved-prompts"

function shortcutLabel(shortcut: string) {
  const macOS = document.documentElement.dataset.platform === "macos"
  return shortcut
    .replace("Mod", macOS ? "⌘" : "Ctrl")
    .replaceAll("+Shift", macOS ? "⇧" : "+Shift")
    .replaceAll("+Left", macOS ? "←" : "+Left")
    .replaceAll("+Right", macOS ? "→" : "+Right")
    .replaceAll("+Up", macOS ? "↑" : "+Up")
    .replaceAll("+Down", macOS ? "↓" : "+Down")
}

export function CommandMenu({
  commands,
  close,
  projects,
  projectsLoading,
  projectsError,
  chooseFolder,
  openProject,
  listSavedPrompts,
  savePrompt,
  copyPrompt,
}: CommandMenuProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const returnFocus = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  const titleID = useId()
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [view, setView] = useState<CommandMenuView>("commands")
  const [savedPrompts, setSavedPrompts] = useState<ReadonlyArray<SavedPrompt>>([])
  const [operationPending, setOperationPending] = useState(false)
  const [operationError, setOperationError] = useState<string>()
  const definitions = filterCommandMenuDefinitions(query)
  const availableDefinitions = definitions.filter(
    ({ id }) => !commands.find((command) => command.id === id)?.disabled,
  )
  const activeID = availableDefinitions[activeIndex]?.id
  const filteredProjects = projects.filter((project) => projectCatalogMatches(project, query))
  const orderedProjects = [
    ...filteredProjects.filter((project) => project.project.id !== Project.ID.global),
    ...filteredProjects.filter((project) => project.project.id === Project.ID.global),
  ]
  const projectOptionCount = orderedProjects.length + 1
  const filteredPrompts = savedPrompts.filter((prompt) =>
    prompt.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )

  useEffect(() => {
    return () => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus()
    }
  }, [])

  useEffect(() => {
    searchRef.current?.focus()
  }, [view])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, view])

  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLElement>('.command-menu__item[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [activeID, activeIndex, view])

  const execute = (id: CommandMenuCommandID) => {
    if (id === "open-project") {
      setView("projects")
      setQuery("")
      return
    }
    if (id === "save-prompt") {
      setView("save-prompt")
      setQuery("")
      setOperationError(undefined)
      return
    }
    if (id === "view-saved-prompts") {
      setView("saved-prompts")
      setQuery("")
      setOperationError(undefined)
      setOperationPending(true)
      void listSavedPrompts().then(
        (prompts) => {
          setSavedPrompts(prompts)
          setOperationPending(false)
        },
        (cause: unknown) => {
          setOperationError(
            cause instanceof Error ? cause.message : "Saved prompts could not load.",
          )
          setOperationPending(false)
        },
      )
      return
    }
    const command = commands.find((candidate) => candidate.id === id)
    if (command === undefined || command.disabled) return
    close()
    command.run()
  }

  const submitSavedPrompt = () => {
    if (operationPending || query.trim() === "") return
    setOperationPending(true)
    setOperationError(undefined)
    void savePrompt(query).then(
      () => {
        setView("saved-prompts")
        setQuery("")
        void listSavedPrompts().then(
          (prompts) => {
            setSavedPrompts(prompts)
            setOperationPending(false)
          },
          (cause: unknown) => {
            setOperationError(
              cause instanceof Error ? cause.message : "Saved prompts could not load.",
            )
            setOperationPending(false)
          },
        )
      },
      (cause: unknown) => {
        setOperationError(cause instanceof Error ? cause.message : "The prompt could not be saved.")
        setOperationPending(false)
      },
    )
  }

  const copySavedPrompt = (prompt: SavedPrompt) => {
    if (operationPending) return
    setOperationPending(true)
    setOperationError(undefined)
    void copyPrompt(prompt.text).then(
      () => close(),
      (cause: unknown) => {
        setOperationError(
          cause instanceof Error ? cause.message : "The prompt could not be copied.",
        )
        setOperationPending(false)
      },
    )
  }

  return createPortal(
    <div
      className="command-menu-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        ref={dialogRef}
        className="command-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            if (view !== "commands") {
              setView("commands")
              setQuery("")
              setOperationError(undefined)
            } else close()
          } else if (event.key === "ArrowDown" && view === "projects") {
            event.preventDefault()
            setActiveIndex((current) => (current + 1) % projectOptionCount)
          } else if (event.key === "ArrowUp" && view === "projects") {
            event.preventDefault()
            setActiveIndex((current) => (current - 1 + projectOptionCount) % projectOptionCount)
          } else if (event.key === "Enter" && view === "projects") {
            event.preventDefault()
            if (activeIndex === 0) {
              close()
              chooseFolder()
            } else {
              const project = orderedProjects[activeIndex - 1]
              if (project !== undefined) {
                close()
                openProject(project, true)
              }
            }
          } else if (
            event.key === "ArrowDown" &&
            view === "saved-prompts" &&
            filteredPrompts.length > 0
          ) {
            event.preventDefault()
            setActiveIndex((current) => (current + 1) % filteredPrompts.length)
          } else if (
            event.key === "ArrowUp" &&
            view === "saved-prompts" &&
            filteredPrompts.length > 0
          ) {
            event.preventDefault()
            setActiveIndex(
              (current) => (current - 1 + filteredPrompts.length) % filteredPrompts.length,
            )
          } else if (event.key === "Enter" && view === "saved-prompts") {
            event.preventDefault()
            const prompt = filteredPrompts[activeIndex]
            if (prompt !== undefined) copySavedPrompt(prompt)
          } else if (
            event.key === "Enter" &&
            view === "save-prompt" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault()
            submitSavedPrompt()
          } else if (
            event.key === "ArrowDown" &&
            view === "commands" &&
            availableDefinitions.length > 0
          ) {
            event.preventDefault()
            setActiveIndex((current) => (current + 1) % availableDefinitions.length)
          } else if (
            event.key === "ArrowUp" &&
            view === "commands" &&
            availableDefinitions.length > 0
          ) {
            event.preventDefault()
            setActiveIndex(
              (current) =>
                (current - 1 + availableDefinitions.length) % availableDefinitions.length,
            )
          } else if (event.key === "Enter" && view === "commands" && activeID !== undefined) {
            event.preventDefault()
            execute(activeID)
          } else if (event.key === "Tab") {
            const focusable = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
              ),
            )
            const first = focusable[0]
            const last = focusable.at(-1)
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <h1 id={titleID} className="command-menu__title">
          {view === "projects"
            ? "Open project"
            : view === "save-prompt"
              ? "Save a prompt"
              : view === "saved-prompts"
                ? "Saved prompts"
                : "Command menu"}
        </h1>
        {view === "save-prompt" ? (
          <div className="command-menu__prompt-entry">
            <div className="command-menu__page-header">
              <strong>Save a prompt</strong>
              <kbd>esc</kbd>
            </div>
            <div className="command-menu__prompt-editor">
              <textarea
                ref={(element) => {
                  searchRef.current = element
                }}
                value={query}
                placeholder="Write a prompt to save"
                aria-label="Prompt to save"
                autoComplete="off"
                spellCheck={true}
                rows={5}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="command-menu__search-wrap">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.25" />
              <path d="m12.5 12.5 4 4" />
            </svg>
            <input
              ref={(element) => {
                searchRef.current = element
              }}
              type="search"
              value={query}
              placeholder={
                view === "projects"
                  ? "Search projects"
                  : view === "saved-prompts"
                    ? "Search saved prompts"
                    : "Search commands"
              }
              aria-label={
                view === "projects"
                  ? "Search projects"
                  : view === "saved-prompts"
                    ? "Search saved prompts"
                    : "Search commands"
              }
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>esc</kbd>
          </div>
        )}
        <div
          className={`command-menu__results${view === "save-prompt" ? " command-menu__results--prompt" : ""}`}
          role={view === "save-prompt" ? undefined : "listbox"}
          aria-label={
            view === "save-prompt"
              ? undefined
              : view === "projects"
                ? "Projects"
                : view === "saved-prompts"
                  ? "Saved prompts"
                  : "Commands"
          }
        >
          {view === "projects" ? (
            <>
              <button
                type="button"
                role="option"
                aria-selected={activeIndex === 0}
                className={`command-menu__item${activeIndex === 0 ? " command-menu__item--active" : ""}`}
                onMouseMove={() => setActiveIndex(0)}
                onClick={() => {
                  close()
                  chooseFolder()
                }}
              >
                <span className="command-menu__folder-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <path d="M2.75 5.75h5l1.5 1.5h8v7.5a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5v-9Z" />
                  </svg>
                </span>
                <span className="command-menu__item-copy">
                  <strong>Choose from folder...</strong>
                  <small>Open a local directory</small>
                </span>
              </button>
              {projectsLoading ? (
                <div className="command-menu__empty">Loading projects...</div>
              ) : projectsError !== undefined ? (
                <div className="command-menu__empty">{projectsError}</div>
              ) : (
                orderedProjects.map((project, index) => {
                  const global = project.project.id === Project.ID.global
                  const name = projectDisplayName(
                    project.project.name,
                    project.project.canonical,
                    project.project.id,
                  )
                  const icon = project.project.icon?.override ?? project.project.icon?.url
                  const active = activeIndex === index + 1
                  return (
                    <button
                      key={project.project.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`command-menu__item${active ? " command-menu__item--active" : ""}`}
                      onMouseMove={() => setActiveIndex(index + 1)}
                      onClick={() => {
                        close()
                        openProject(project, true)
                      }}
                    >
                      <span className="project-icon command-menu__project-icon" aria-hidden="true">
                        {global ? (
                          <svg className="project-icon__globe" viewBox="0 0 16 16">
                            <circle cx="8" cy="8" r="5.5" />
                            <path d="M2.5 8h11M8 2.5c1.7 1.5 2.5 3.3 2.5 5.5S9.7 12 8 13.5C6.3 12 5.5 10.2 5.5 8S6.3 4 8 2.5Z" />
                          </svg>
                        ) : icon === undefined ? (
                          <span>{projectInitial(name)}</span>
                        ) : (
                          <img src={icon} alt="" />
                        )}
                      </span>
                      <span className="command-menu__item-copy">
                        <strong>{global ? "Global" : name}</strong>
                        <small>{global ? "Global project" : project.project.canonical}</small>
                      </span>
                    </button>
                  )
                })
              )}
            </>
          ) : view === "save-prompt" ? (
            operationError === undefined ? null : (
              <div className="command-menu__prompt-error">{operationError}</div>
            )
          ) : view === "saved-prompts" ? (
            operationPending && savedPrompts.length === 0 ? (
              <div className="command-menu__empty">Loading saved prompts...</div>
            ) : operationError !== undefined ? (
              <div className="command-menu__empty">{operationError}</div>
            ) : filteredPrompts.length === 0 ? (
              <div className="command-menu__empty">
                {savedPrompts.length === 0 ? "No saved prompts yet" : "No matching prompts"}
              </div>
            ) : (
              filteredPrompts.map((prompt, index) => {
                const active = activeIndex === index
                return (
                  <button
                    key={prompt.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`command-menu__item command-menu__prompt-item${active ? " command-menu__item--active" : ""}`}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => copySavedPrompt(prompt)}
                  >
                    <span className="command-menu__item-copy">
                      <strong>{prompt.text}</strong>
                      <small>Copy to clipboard</small>
                    </span>
                  </button>
                )
              })
            )
          ) : definitions.length === 0 ? (
            <div className="command-menu__empty">No matching commands</div>
          ) : (
            definitions.map((definition) => {
              const command = commands.find(({ id }) => id === definition.id)
              const disabled = command === undefined || command.disabled === true
              const active = !disabled && definition.id === activeID
              return (
                <button
                  key={definition.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={disabled}
                  className={`command-menu__item${active ? " command-menu__item--active" : ""}`}
                  onMouseMove={() => {
                    const index = availableDefinitions.findIndex(({ id }) => id === definition.id)
                    if (index >= 0) setActiveIndex(index)
                  }}
                  onClick={() => execute(definition.id)}
                >
                  <span className="command-menu__item-copy">
                    <strong>{definition.title}</strong>
                    <small>{definition.category}</small>
                  </span>
                  {definition.shortcut === undefined ? null : (
                    <kbd>{shortcutLabel(definition.shortcut)}</kbd>
                  )}
                </button>
              )
            })
          )}
        </div>
        <footer className="command-menu__footer">
          {view === "save-prompt" ? (
            <span>
              <kbd>⇧↵</kbd> New line
            </span>
          ) : (
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> Navigate
            </span>
          )}
          <span>
            <kbd>↵</kbd>{" "}
            {view === "saved-prompts" ? "Copy" : view === "save-prompt" ? "Save and view" : "Run"}
          </span>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
