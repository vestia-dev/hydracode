import type {
  ApplicationStateLoad,
  ProjectSelectionState,
  ProjectUIState,
} from "../../../shared/applicationState"
import { locationKey } from "../../../shared/domain/projectCatalog"

export function restoreApplicationState<
  T extends {
    readonly project: { readonly id: Project.ID; readonly canonical: string }
    readonly locations: ReadonlyArray<{
      readonly ref: import("@opencode-ai/client/effect").Location.Ref
      readonly kind?: string
    }>
  },
>(state: ApplicationStateLoad | ProjectSelectionState, availableProjects: ReadonlyArray<T>) {
  const projectsByLocation = new Map(
    availableProjects.flatMap((project) =>
      project.locations.map(({ ref }) => [locationKey(ref), { ...project, location: ref }]),
    ),
  )
  const legacy = "openProjectIDs" in state
  const savedLocations = legacy
    ? state.openProjectIDs.flatMap((projectID) => {
        const project = availableProjects.find((item) => item.project.id === projectID)
        const location = project?.locations.find(
          (item) => item.ref.directory === project.project.canonical,
        )
        return location === undefined ? [] : [{ projectID, location: location.ref }]
      })
    : state.openLocations
  const projects = savedLocations.flatMap((item) => {
    const key = locationKey(item.location)
    const project = projectsByLocation.get(key)
    return project === undefined ? [] : [project]
  })
  const restoredProjects = projects
  const activeSavedKey = legacy
    ? state.activeProjectID === null
      ? null
      : (() => {
          const item = savedLocations.find(
            (candidate) => candidate.projectID === state.activeProjectID,
          )
          return item === undefined ? null : locationKey(item.location)
        })()
    : state.activeLocationKey
  const activeLocationKey =
    activeSavedKey !== null && projectsByLocation.has(activeSavedKey)
      ? activeSavedKey
      : restoredProjects[0] === undefined
        ? null
        : locationKey(restoredProjects[0].location)
  const projectUIStates: ReadonlyArray<ProjectUIState> = legacy
    ? state.projects.flatMap((projectState) => {
        const project = availableProjects.find((item) => item.project.id === projectState.projectID)
        const canonical = project?.locations.find((item) => item.kind === "canonical")
        return canonical === undefined
          ? []
          : [{ ...projectState, locationKey: locationKey(canonical.ref) }]
      })
    : "projects" in state
      ? state.projects
      : []
  return { projects: restoredProjects, activeLocationKey, projectUIStates }
}
import type { Project } from "@opencode-ai/client/effect"
