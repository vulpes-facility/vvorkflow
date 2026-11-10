import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

interface IconButtonProps extends Omit<
  React.ComponentProps<'button'>,
  'children' | 'type' | 'aria-label'
> {
  icon: LucideIcon
  /** The accessible name, and the text of the tooltip. */
  label: string
  /** The shortcut that the tooltip shows after the label, such as `+`. */
  keys?: string
  /** For a toggle: true draws the button with an outline, and sets `aria-pressed`. */
  pressed?: boolean
}

/**
 * A button of 24 by 24 CSS pixels with an icon, a tooltip, and an accessible
 * name. A pressed toggle has an outline, so that the state is not only a
 * color (WCAG 2.2 SC 1.4.1).
 */
export function IconButton({
  icon: Icon,
  label,
  keys,
  pressed,
  className,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:text-subtle-foreground',
              pressed &&
                'bg-selection text-foreground ring-1 ring-input ring-inset focus-visible:ring-ring',
              className,
            )}
            {...props}
          />
        }
      >
        <Icon className="size-icon" strokeWidth={1.75} aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {keys && (
          <kbd className="font-mono text-muted-foreground" aria-hidden>
            {keys}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
