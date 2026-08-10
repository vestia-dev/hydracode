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

export function projectSessionSummaries(
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

export function projectCatalogItems(
  projects: ReadonlyArray<Project.Info>,
): ReadonlyArray<ProjectCatalogItem> {
  return projects
    .filter((project) => project.id !== Project.ID.global && project.canonical !== "/")
    .map((project) => ({
      project: {
        id: project.id,
        canonical: project.canonical,
        ...projectName(project.name),
        ...(project.icon === undefined ? {} : { icon: project.icon }),
      },
      location: Location.Ref.make({ directory: project.canonical }),
      updated: project.time.updated,
    }))
    .toSorted((left, right) => right.updated - left.updated)
}

export function projectName(name: string | undefined) {
  const normalized = name?.trim()
  return normalized === undefined || normalized === "" ? {} : { name: normalized }
}
import { Location, Project } from "@opencode-ai/client/effect"
import type { ProjectCatalogItem } from "../project"
