import type { Platform } from '@/shared/lib'
import { LogoMark } from '@/shared/ui'

interface SideBarProps {
  platform: Platform
  /** The id of the panel, which the tabs of the activity bar point at. */
  id: string
  title: string
  /** Fixed actions at the right of the header. They are always visible. */
  actions?: React.ReactNode
  children?: React.ReactNode
}

/**
 * The panel next to the activity bar. It shows the view that the activity bar
 * selects.
 *
 * Its top row has the design of the title bar, so that the top cell of the
 * activity bar, this row, and the title bar look like one header row, which
 * drags the window. On macOS the window buttons and the mark are in this row.
 * The view title is in the row below, at the height of the editor tabs.
 */
export function SideBar({
  platform,
  id,
  title,
  actions,
  children,
}: SideBarProps) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-sidebar">
      <div
        data-tauri-drag-region
        className="flex h-titlebar shrink-0 items-center border-b border-hairline pl-[calc(var(--vv-traffic-lights-w)-var(--vv-activitybar-w))]"
      >
        {platform === 'macos' && (
          <LogoMark className="pointer-events-none size-5 text-foreground" />
        )}
      </div>
      <section
        id={id}
        role="tabpanel"
        aria-label={title}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex h-tab shrink-0 items-center gap-1 pr-2 pl-4">
          <h2 className="flex-1 truncate text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {title}
          </h2>
          {actions}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </section>
    </div>
  )
}
