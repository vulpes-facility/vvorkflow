import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  /** The actions that are always visible, for example a button. */
  children?: React.ReactNode
  className?: string
}

/** A short message for a view that has no content, with an optional action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      <Icon
        className="size-icon-lg text-subtle-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="flex flex-col gap-1">
        <p className="text-ui font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}
