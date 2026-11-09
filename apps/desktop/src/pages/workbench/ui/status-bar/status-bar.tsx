import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib'

/** One item of the status bar. */
export interface StatusItem {
  id: string
  label: string
  icon?: LucideIcon
  /**
   * A longer text, in the tooltip and for assistive technology. The visible
   * label stays at the start of the accessible name.
   */
  description?: string
  onClick?: () => void
}

interface StatusBarProps {
  start?: StatusItem[]
  end?: StatusItem[]
}

/** The bar under the editor area, with short facts about the workspace. */
export function StatusBar({ start = [], end = [] }: StatusBarProps) {
  return (
    <footer
      aria-label="Status"
      // The top hairline is drawn over the items, so that they keep the full 24 px height.
      className="relative flex min-h-statusbar shrink-0 flex-wrap items-stretch justify-between bg-chrome px-1 text-xs text-chrome-foreground before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-hairline"
    >
      {/* In a narrow window the items wrap to more rows, so that no label is cut (WCAG 2.2 SC 1.4.10). */}
      <div className="flex min-w-0 flex-wrap items-stretch">
        {start.map(renderItem)}
      </div>
      <div className="flex min-w-0 flex-wrap items-stretch">
        {end.map(renderItem)}
      </div>
    </footer>
  )
}

function renderItem(item: StatusItem) {
  const Icon = item.icon
  const content = (
    <>
      {Icon && <Icon className="size-icon-sm" strokeWidth={1.75} aria-hidden />}
      <span className="truncate whitespace-nowrap">{item.label}</span>
      {/* The description is in the tooltip for the pointer, and here for assistive technology. */}
      {item.description && (
        <span className="sr-only">: {item.description}</span>
      )}
    </>
  )
  const className =
    'flex h-statusbar max-w-full min-w-6 shrink-0 items-center gap-1.5 px-2'
  if (item.onClick) {
    return (
      <button
        key={item.id}
        type="button"
        title={item.description}
        onClick={item.onClick}
        className={cn(
          className,
          'outline-none hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
        )}
      >
        {content}
      </button>
    )
  }
  return (
    <span key={item.id} title={item.description} className={className}>
      {content}
    </span>
  )
}
