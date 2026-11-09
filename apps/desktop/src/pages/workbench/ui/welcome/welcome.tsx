import {
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranchPlus,
  Plus,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { Platform } from '@/shared/lib'
import { LogoMark, Shortcut } from '@/shared/ui'

/** A folder in the projects root of the engine. */
export interface WelcomeProject {
  /** The path of the folder in the engine. */
  id: string
  name: string
  /** True for a git repository, which has its own icon. */
  git: boolean
}

interface StartAction {
  label: string
  icon: LucideIcon
  shortcut?: string
  onSelect: () => void
}

interface WelcomeProps {
  platform: Platform
  projects: WelcomeProject[]
  /** The message of an engine that did not start. It shows in place of the projects. */
  engineError?: string
  onNewProject?: () => void
  onOpenFolder?: () => void
  onAddWorktree?: () => void
  onOpenProject?: (project: WelcomeProject) => void
  /** The shortcut of the command palette, such as `mod+shift+p`, for the hint at the bottom. */
  commandPaletteShortcut?: string
}

/**
 * The landing tab of the editor area: the start actions and the projects of
 * the projects root. It shows only the actions that have a handler, and no
 * Projects section when the root has no project.
 */
export function Welcome({
  platform,
  projects,
  engineError,
  onNewProject,
  onOpenFolder,
  onAddWorktree,
  onOpenProject,
  commandPaletteShortcut,
}: WelcomeProps) {
  const actions: StartAction[] = [
    onNewProject && {
      label: 'New project…',
      icon: Plus,
      shortcut: 'mod+n',
      onSelect: onNewProject,
    },
    onOpenFolder && {
      label: 'Open folder…',
      icon: FolderOpen,
      shortcut: 'mod+o',
      onSelect: onOpenFolder,
    },
    onAddWorktree && {
      label: 'Add worktree…',
      icon: GitBranchPlus,
      onSelect: onAddWorktree,
    },
  ].filter((action): action is StartAction => Boolean(action))

  return (
    // The scroll area takes the focus, so that the keyboard can scroll it.
    <div
      role="region"
      aria-label="Welcome"
      tabIndex={0}
      className="@container h-full overflow-auto bg-editor outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {/* The layout follows the width of the editor area, which the side bar changes. */}
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-10 px-6 py-10 @xl:gap-12 @xl:px-12 @xl:py-16">
        <header className="flex items-center gap-4">
          <LogoMark className="size-11 text-foreground" />
          <h1 className="text-2xl font-semibold tracking-display text-foreground">
            vvorkflow
          </h1>
        </header>

        <div className="grid grid-cols-1 gap-8 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @2xl:gap-10">
          {actions.length > 0 && (
            <section
              aria-labelledby="welcome-start"
              className="flex flex-col gap-2"
            >
              <h2
                id="welcome-start"
                className="px-2 text-xs font-medium text-muted-foreground"
              >
                Start
              </h2>
              <ul className="flex flex-col">
                {actions.map((action) => (
                  <li key={action.label}>
                    <button
                      type="button"
                      onClick={action.onSelect}
                      className="group flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-ui text-foreground outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <action.icon
                        className="size-icon text-link"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">{action.label}</span>
                      {action.shortcut && (
                        <Shortcut keys={action.shortcut} platform={platform} />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(projects.length > 0 || engineError) && (
            <section
              aria-labelledby="welcome-projects"
              className={
                actions.length > 0
                  ? 'flex flex-col gap-2'
                  : 'flex flex-col gap-2 @2xl:col-span-2'
              }
            >
              <h2
                id="welcome-projects"
                className="px-2 text-xs font-medium text-muted-foreground"
              >
                Projects
              </h2>
              {engineError ? (
                <p className="flex items-start gap-2.5 px-2 py-1 text-ui text-foreground">
                  <TriangleAlert
                    className="mt-0.5 size-icon shrink-0 text-destructive"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {engineError}
                </p>
              ) : (
                <ul className="flex flex-col">
                  {projects.map((project) => (
                    <li key={project.id}>
                      <ProjectRow project={project} onOpen={onOpenProject} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {commandPaletteShortcut && (
          <p className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            Show all commands
            <Shortcut keys={commandPaletteShortcut} platform={platform} />
          </p>
        )}
      </div>
    </div>
  )
}

function ProjectRow({
  project,
  onOpen,
}: {
  project: WelcomeProject
  onOpen?: (project: WelcomeProject) => void
}) {
  const Icon = project.git ? FolderGit2 : Folder
  const content = (
    <>
      <Icon
        className="size-icon shrink-0 text-subtle-foreground"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-ui text-foreground">
        {project.name}
      </span>
      {project.git && <span className="sr-only">, git repository</span>}
    </>
  )
  const className =
    'flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 py-1 text-left'
  if (!onOpen) return <div className={className}>{content}</div>
  return (
    <button
      type="button"
      onClick={() => onOpen(project)}
      className={`${className} outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring`}
    >
      {content}
    </button>
  )
}
