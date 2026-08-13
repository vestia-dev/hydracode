import type { Project } from "@opencode-ai/client/effect"
import type { ProjectSelectionState } from "../../../shared/applicationState"

export function restoreApplicationState<
  T extends { readonly project: { readonly id: Project.ID } },
>(state: ProjectSelectionState, availableProjects: ReadonlyArray<T>) {
  const projectsByID = new Map(availableProjects.map((project) => [project.project.id, project]))
  const projects = state.openProjectIDs.flatMap((projectID) => {
    const project = projectsByID.get(projectID)
    return project === undefined ? [] : [project]
  })
  const activeProjectID =
    state.activeProjectID !== null &&
    projects.some((project) => project.project.id === state.activeProjectID)
      ? state.activeProjectID
      : (projects[0]?.project.id ?? null)
  return { projects, activeProjectID }
}
