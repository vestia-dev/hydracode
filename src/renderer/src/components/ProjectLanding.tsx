import { Background, BackgroundVariant, ReactFlow } from "@xyflow/react"
import type { ProjectCatalogItem } from "../../../shared/project"
import type { ProjectCatalogState } from "../hooks/useProjectController"
import { projectDisplayName, projectInitial } from "../projectors/projectPresentation"

interface ProjectLandingProps {
  readonly catalog: ProjectCatalogState
  readonly error?: string | undefined
  readonly openProject: (project: ProjectCatalogItem) => void
  readonly newProject: () => void
  readonly retry: () => void
}

function projectName(item: ProjectCatalogItem) {
  return projectDisplayName(item.project.name, item.location.directory)
}

export function ProjectLanding({
  catalog,
  error,
  openProject,
  newProject,
  retry,
}: ProjectLandingProps) {
  return (
    <section className="project-landing" aria-label="Open a project">
      <ReactFlow nodes={[]} edges={[]} fitView proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--color-grid)" />
      </ReactFlow>

      <div className="project-landing__panel">
        <header className="project-landing__header">
          <p className="project-landing__eyebrow">HydraCode</p>
          <h1>Open a project</h1>
          <p>Continue with a project known to OpenCode, or choose a new folder.</p>
        </header>

        {error === undefined ? null : <p className="project-landing__error">{error}</p>}

        <div className="project-landing__catalog">
          {catalog._tag === "Loading" ? (
            <p className="project-landing__status">Loading projects...</p>
          ) : catalog._tag === "Error" ? (
            <div className="project-landing__status">
              <p>{catalog.message}</p>
              <button type="button" className="open-project-button" onClick={retry}>
                Try again
              </button>
            </div>
          ) : catalog.projects.length === 0 ? (
            <p className="project-landing__status">No existing projects yet.</p>
          ) : (
            catalog.projects.map((item) => {
              const name = projectName(item)
              const icon = item.project.icon?.override ?? item.project.icon?.url
              return (
                <button
                  type="button"
                  className="project-card"
                  key={item.project.id}
                  onClick={() => openProject(item)}
                >
                  <span
                    className="project-icon project-card__icon"
                    style={{ backgroundColor: item.project.icon?.color }}
                    aria-hidden="true"
                  >
                    {icon === undefined ? (
                      <span>{projectInitial(name)}</span>
                    ) : (
                      <img src={icon} alt="" />
                    )}
                  </span>
                  <span className="project-card__copy">
                    <strong>{name}</strong>
                    <span>{item.location.directory}</span>
                  </span>
                  <span className="project-card__arrow" aria-hidden="true">
                    &rarr;
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="project-landing__new">
          <div>
            <strong>New project</strong>
            <span>Choose a folder in Finder</span>
          </div>
          <button type="button" className="primary-button" onClick={newProject}>
            Choose folder
          </button>
        </div>
      </div>
    </section>
  )
}
