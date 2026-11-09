import { ChevronRight, FolderGit2, GitBranch } from 'lucide-react'
import type { WindowControls as Controls } from '@/shared/api'
import { cn, type Platform } from '@/shared/lib'
import { WindowControls } from './window-controls'

/** The project and the worktree that the window shows. */
export interface WindowContext {
  project: string
  /** The branch of the active worktree. */
  branch?: string
}

interface TitleBarProps {
  platform: Platform
  /** Without a context, as before a project opens, the title bar is empty. */
  context?: WindowContext
  /** The native window. Without it, as in a browser, the title bar has no window buttons. */
  windowControls?: Controls
  /**
   * Whether the macOS window buttons reach into the title bar, as they do when
   * the side bar is closed. The title bar then starts after them.
   */
  besideWindowButtons?: boolean
}

/**
 * The header above the editor area. It drags the window, and on Windows and
 * Linux it holds the window buttons, because those windows have no native
 * decorations.
 */
export function TitleBar({
  platform,
  context,
  windowControls,
  besideWindowButtons = false,
}: TitleBarProps) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-titlebar shrink-0 items-center border-b border-hairline bg-chrome"
    >
      <div
        data-tauri-drag-region
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 px-3 text-ui text-chrome-foreground',
          besideWindowButtons &&
            'pl-[calc(var(--vv-traffic-lights-w)-var(--vv-activitybar-w))]',
        )}
      >
        {context ? (
          <nav aria-label="Location" className="pointer-events-none min-w-0">
            <ol className="flex min-w-0 items-center gap-1.5">
              <li className="flex min-w-0 items-center gap-1.5 text-foreground">
                <FolderGit2
                  className="size-icon-sm shrink-0 text-subtle-foreground"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="truncate font-medium" title={context.project}>
                  {context.project}
                </span>
              </li>
              {context.branch && (
                <li className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight
                    className="size-icon-sm shrink-0 text-subtle-foreground"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <GitBranch
                    className="size-icon-sm shrink-0 text-subtle-foreground"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="truncate" title={context.branch}>
                    {context.branch}
                  </span>
                </li>
              )}
            </ol>
          </nav>
        ) : null}
      </div>
      {windowControls && platform !== 'macos' && (
        <WindowControls controls={windowControls} variant={platform} />
      )}
    </header>
  )
}
