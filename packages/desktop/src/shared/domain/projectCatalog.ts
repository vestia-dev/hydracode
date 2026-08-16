export interface CatalogSession<ID extends string = string> {
  readonly id: ID
  readonly parentID?: ID | null | undefined
  readonly created: number
  readonly title: string
}

export function sessionRootID<ID extends string>(
  session: Pick<CatalogSession<ID>, "id" | "parentID">,
  sessionsByID: ReadonlyMap<ID, Pick<CatalogSession<ID>, "id" | "parentID">>,
) {
  let current = session
  const seen = new Set([current.id])
  while (current.parentID != null) {
    const parent = sessionsByID.get(current.parentID)
    if (parent === undefined || seen.has(parent.id)) break
    seen.add(parent.id)
    current = parent
  }
  return current.id
}

export function selectedSessionFamily<T extends CatalogSession>(
  sessions: ReadonlyArray<T>,
  selectedID: string,
) {
  const sessionsByID = new Map(sessions.map((session) => [session.id, session] as const))
  const selected = sessionsByID.get(selectedID)
  if (selected === undefined) return []
  const selectedRootID = sessionRootID(selected, sessionsByID)
  return sessions.filter((session) => sessionRootID(session, sessionsByID) === selectedRootID)
}

export function createSessionSummaries(
  sessions: ReadonlyArray<CatalogSession>,
  activeIDs: ReadonlySet<string>,
) {
  const sessionsByID = new Map(sessions.map((session) => [session.id, session] as const))
  const activeRoots = new Set(
    sessions
      .filter((session) => activeIDs.has(session.id))
      .map((session) => sessionRootID(session, sessionsByID)),
  )
  return sessions
    .filter((session) => session.parentID == null)
    .toSorted((left, right) => right.created - left.created)
    .map((session) => ({
      id: session.id,
      created: session.created,
      title: session.title,
      active: activeRoots.has(session.id),
    }))
}

export function locationsEqual(left: Location.Ref, right: Location.Ref) {
  return left.directory === right.directory && left.workspaceID === right.workspaceID
}

export function locationKey(location: Location.Ref) {
  return `${location.directory}\u0000${location.workspaceID ?? ""}`
}

export function availableProjects(
  projects: ReadonlyArray<Project.Info>,
  extraLocations: ReadonlyMap<Project.ID, ReadonlyArray<ProjectLocation>> = new Map(),
): ReadonlyArray<ProjectCatalogEntry> {
  const available = projects
    .filter((project) => project.id === Project.ID.global || project.canonical !== "/")
    .map((project) => {
      const locations: ReadonlyArray<ProjectLocation> = dedupeLocations([
        { ref: Location.Ref.make({ directory: project.canonical }), kind: "canonical" as const },
        ...(project.sandboxes ?? []).map((directory) => ({
          ref: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
          kind: "sandbox" as const,
        })),
        ...(extraLocations.get(project.id) ?? []),
      ])
      return {
        project: {
          id: project.id,
          canonical: project.canonical,
          ...projectName(project.name),
          ...(project.icon === undefined ? {} : { icon: project.icon }),
        },
        locations,
        updated: project.time.updated,
      }
    })
  if (!available.some((project) => project.project.id === Project.ID.global)) {
    available.push({
      project: { id: Project.ID.global, canonical: AbsolutePath.make("/") },
      locations: [
        { ref: Location.Ref.make({ directory: AbsolutePath.make("/") }), kind: "canonical" },
      ],
      updated: 0,
    })
  }
  return available.toSorted((left, right) => {
    if (left.project.id === Project.ID.global) return 1
    if (right.project.id === Project.ID.global) return -1
    return right.updated - left.updated
  })
}

const locationKindRank = { selected: 0, sandbox: 1, worktree: 2, canonical: 3 } as const

export function dedupeLocations(locations: ReadonlyArray<ProjectLocation>) {
  const byKey = new Map<string, ProjectLocation>()
  for (const location of locations) {
    const key = locationKey(location.ref)
    const current = byKey.get(key)
    if (current === undefined || locationKindRank[location.kind] > locationKindRank[current.kind])
      byKey.set(key, location)
  }
  return Array.from(byKey.values())
}

export function mergeProjectCatalogEntry(
  projects: ReadonlyArray<ProjectCatalogEntry>,
  selected: ProjectCatalogEntry,
): ReadonlyArray<ProjectCatalogEntry> {
  return projects.some((project) => project.project.id === selected.project.id)
    ? projects.map((project) =>
        project.project.id === selected.project.id
          ? {
              ...project,
              locations: dedupeLocations([...project.locations, ...selected.locations]),
            }
          : project,
      )
    : [selected, ...projects]
}

export function projectLocationLabel(location: ProjectLocation) {
  if (location.kind === "canonical") return "Main"
  return location.ref.directory.split("/").findLast(Boolean) ?? location.ref.directory
}

export function projectCatalogMatches(project: ProjectCatalogEntry, query: string) {
  const search = query.trim().toLocaleLowerCase()
  if (search === "") return true
  return [
    project.project.name,
    project.project.canonical,
    ...project.locations.map(({ ref }) => ref.directory),
  ]
    .filter((value): value is string => value !== undefined)
    .some((value) => value.toLocaleLowerCase().includes(search))
}

export function resolvedProjectDirectory(
  projectID: Project.ID,
  currentDirectory: AbsolutePath,
  requestedDirectory: AbsolutePath,
) {
  return projectID === Project.ID.global ? requestedDirectory : currentDirectory
}

export function projectName(name: string | undefined) {
  const normalized = name?.trim()
  return normalized === undefined || normalized === "" ? {} : { name: normalized }
}
import { AbsolutePath, Location, Project } from "@opencode-ai/client/effect"
import type { ProjectCatalogEntry, ProjectLocation } from "../project"
