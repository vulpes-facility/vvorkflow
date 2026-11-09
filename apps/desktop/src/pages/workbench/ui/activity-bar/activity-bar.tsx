import type { LucideIcon } from 'lucide-react'
import { useRef } from 'react'
import { cn, type Platform } from '@/shared/lib'
import type { Activity } from '../../model/views'
import {
  LogoMark,
  Shortcut,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/ui'

interface ActivityBarProps {
  platform: Platform
  activities: Activity[]
  /** The view that the side bar shows, or shows when it opens again. */
  activeId: string
  /** Whether the side bar is open. A closed side bar has no selected view. */
  open: boolean
  /** A click or Enter on a tab: it opens the view, or closes the side bar when the view is open. */
  onSelect: (id: string) => void
  /** An arrow key, Home, or End: it opens the view and never closes the side bar. */
  onNavigate: (id: string) => void
  /** The id of the element that shows the selected view, for `aria-controls`. */
  panelId: string
  /** The items at the bottom, for example the settings. */
  footer?: React.ReactNode
}

/**
 * The vertical bar at the left edge, at full window height. Its tabs select
 * the view of the side bar. The arrow keys move between the tabs.
 */
export function ActivityBar({
  platform,
  activities,
  activeId,
  open,
  onSelect,
  onNavigate,
  panelId,
  footer,
}: ActivityBarProps) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = activities.length - 1
    const next =
      event.key === 'ArrowDown'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowUp'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined
    if (next === undefined) return
    event.preventDefault()
    if (next !== index) tabs.current[next]?.focus()
    onNavigate(activities[next].id)
  }

  return (
    <nav
      aria-label="Activity"
      className="flex h-full w-activitybar shrink-0 flex-col bg-chrome"
    >
      {/*
        The top cell lines up with the title bar. It has no right border, so
        that it, the top row of the side bar, and the title bar look like one
        header row. On macOS the window buttons are in this row.
      */}
      <div
        data-tauri-drag-region
        className="flex h-titlebar w-full shrink-0 items-center justify-center border-b border-hairline"
      >
        {platform !== 'macos' && (
          <LogoMark className="pointer-events-none size-5 text-foreground" />
        )}
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col border-r border-hairline">
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Views"
          className="flex w-full flex-col"
        >
          {activities.map((activity, index) => {
            // The roving focus stays on the active view; it is selected only while the side bar is open.
            const active = activity.id === activeId
            const selected = active && open
            const Icon = activity.icon
            return (
              <Tooltip key={activity.id}>
                <TooltipTrigger
                  render={
                    <button
                      ref={(element) => {
                        tabs.current[index] = element
                      }}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-expanded={active ? open : undefined}
                      aria-controls={panelId}
                      aria-label={activity.label}
                      tabIndex={active ? 0 : -1}
                      onClick={() => onSelect(activity.id)}
                      onKeyDown={(event) => onKeyDown(event, index)}
                      className={cn(
                        'relative flex h-11 w-full items-center justify-center outline-none',
                        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
                        selected
                          ? 'text-foreground'
                          : 'text-subtle-foreground hover:text-foreground',
                      )}
                    />
                  }
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-indicator',
                      !selected && 'hidden',
                    )}
                  />
                  <Icon
                    className="size-icon-lg"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                </TooltipTrigger>
                <TooltipContent side="right">
                  {activity.label}
                  {activity.shortcut && (
                    <Shortcut keys={activity.shortcut} platform={platform} />
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <div className="mt-auto flex w-full flex-col pb-1">{footer}</div>
      </div>
    </nav>
  )
}

interface ActivityActionProps {
  platform: Platform
  label: string
  icon: LucideIcon
  shortcut?: string
  onClick: () => void
}

/** A button at the bottom of the activity bar, for example the settings. */
export function ActivityAction({
  platform,
  label,
  icon: Icon,
  shortcut,
  onClick,
}: ActivityActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="flex h-11 w-full items-center justify-center text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          />
        }
      >
        <Icon className="size-icon-lg" strokeWidth={1.5} aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {shortcut && <Shortcut keys={shortcut} platform={platform} />}
      </TooltipContent>
    </Tooltip>
  )
}
