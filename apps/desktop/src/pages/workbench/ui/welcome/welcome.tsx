import {
  FolderGit2,
  FolderOpen,
  GitBranchPlus,
  Plus,
  type LucideIcon,
} from 'lucide-react'
import type { Platform } from '@/shared/lib'
import { LogoMark, Shortcut } from '@/shared/ui'

/** A project that the user opened before. */
export interface RecentProject {
  id: string
  name: string
  /** The folder of the project, as the user sees it, for example `~/code/vvorkflow`. */
  path: string
  /** The number of worktrees of the repository. */
  worktrees: number
}

interface StartAction {
  label: string
  icon: LucideIcon
  shortcut?: string
  onSelect: () => void
}

interface WelcomeProps {
  platform: Platform
  recentProjects: RecentProject[]
  onNewProject?: () => void
  onOpenFolder?: () => void
  onAddWorktree?: () => void
  onOpenRecent?: (project: RecentProject) => void
  /** The shortcut of the command palette, such as `mod+shift+p`, for the hint at the bottom. */
  commandPaletteShortcut?: string
}

/**
 * The landing tab of the editor area: the start actions and the recent projects.
 * It shows only the actions that have a handler.
 */
export function Welcome({
  platform,
  recentProjects,
  onNewProject,
  onOpenFolder,
  onAddWorktree,
  onOpenRecent,
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
          <div className="flex flex-col gap-0.5">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
              vvorkflow
            </h1>
            <p className="text-ui text-muted-foreground">
              Direct TUI coding agents across git worktrees.
            </p>
          </div>
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

          <section
            aria-labelledby="welcome-recent"
            className={
              actions.length > 0
                ? 'flex flex-col gap-2'
                : 'flex flex-col gap-2 @2xl:col-span-2'
            }
          >
            <h2
              id="welcome-recent"
              className="px-2 text-xs font-medium text-muted-foreground"
            >
              Recent
            </h2>
            {recentProjects.length === 0 ? (
              <p className="px-2 text-ui text-muted-foreground">
                No recent projects yet.
              </p>
            ) : (
              <ul className="flex flex-col">
                {recentProjects.map((project) => (
                  <li key={project.id}>
                    <RecentProjectRow project={project} onOpen={onOpenRecent} />
                  </li>
                ))}
              </ul>
            )}
          </section>
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

function RecentProjectRow({
  project,
  onOpen,
}: {
  project: RecentProject
  onOpen?: (project: RecentProject) => void
}) {
  const content = (
    <>
      <FolderGit2
        className="size-icon shrink-0 text-subtle-foreground"
        strokeWidth={1.75}
        aria-hidden
      />
      {/* On a narrow editor area, the path goes under the name. */}
      <span className="flex min-w-0 flex-1 flex-col @md:flex-row @md:items-baseline @md:gap-2">
        <span className="shrink-0 text-ui text-foreground">{project.name}</span>
        <span
          className="truncate text-xs text-muted-foreground"
          title={project.path}
        >
          {project.path}
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {project.worktrees} {project.worktrees === 1 ? 'worktree' : 'worktrees'}
      </span>
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
