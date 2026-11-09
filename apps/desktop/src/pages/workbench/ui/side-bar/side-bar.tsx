import type { Platform } from '@/shared/lib'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  LogoMark,
} from '@/shared/ui'

interface SideBarProps {
  platform: Platform
  /** A closed side bar takes no width and renders nothing, so keyboard and assistive technology skip it. */
  open: boolean
  /**
   * Whether the side bar has its own top strip. A drawer under the header row
   * has none, because the header row stays visible above it.
   */
  withTopStrip?: boolean
  /**
   * Whether the scroll area takes the focus, so that the keyboard can scroll
   * it. Turn it off when the content has its own focusable control, such as a
   * tree, so that the view has one tab stop.
   */
  contentFocusable?: boolean
  /**
   * Sets the width of the side bar from the menu of its header row, the way
   * to resize it without a drag (WCAG 2.2 SC 2.5.7). Without it, as in the
   * drawer, the header has no menu.
   */
  onWidth?: (width: SideBarWidth) => void
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
  open,
  withTopStrip = true,
  contentFocusable = true,
  onWidth,
  id,
  title,
  actions,
  children,
}: SideBarProps) {
  return (
    <div
      hidden={!open}
      data-region="side-bar"
      className="flex h-full min-w-0 flex-col bg-sidebar"
    >
      {withTopStrip && (
        <div
          data-tauri-drag-region
          className="flex h-titlebar shrink-0 items-center border-b border-hairline pl-[calc(var(--vv-traffic-lights-w)-var(--vv-activitybar-w))]"
        >
          {platform === 'macos' && (
            <LogoMark className="pointer-events-none size-5 text-foreground" />
          )}
        </div>
      )}
      <section
        id={id}
        role="tabpanel"
        aria-label={title}
        className="flex min-h-0 flex-1 flex-col"
      >
        <SideBarHeader title={title} actions={actions} onWidth={onWidth} />
        {/* The scroll area takes the focus, so that the keyboard can scroll it. */}
        <div
          tabIndex={contentFocusable ? 0 : undefined}
          aria-label={`${title} content`}
          role="region"
          className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {children}
        </div>
      </section>
    </div>
  )
}

/** The widths that the menu of the side bar header offers. */
export type SideBarWidth = 'narrow' | 'default' | 'wide'

const widths: [SideBarWidth, string][] = [
  ['narrow', 'Narrow'],
  ['default', 'Default width'],
  ['wide', 'Wide'],
]

function SideBarHeader({
  title,
  actions,
  onWidth,
}: {
  title: string
  actions?: React.ReactNode
  onWidth?: (width: SideBarWidth) => void
}) {
  const header = (
    <>
      <h2 className="flex-1 truncate text-2xs font-semibold tracking-label text-muted-foreground uppercase">
        {title}
      </h2>
      {actions}
    </>
  )
  const className = 'flex h-tab shrink-0 items-center gap-1 pr-2 pl-4'
  if (!onWidth) return <div className={className}>{header}</div>
  return (
    <ContextMenu>
      <ContextMenuTrigger className={className}>{header}</ContextMenuTrigger>
      <ContextMenuContent>
        {widths.map(([width, label]) => (
          <ContextMenuItem key={width} onClick={() => onWidth(width)}>
            {label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
