import { TriangleAlert } from 'lucide-react'
import { cn } from '../lib'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

interface ErrorMarkProps extends Omit<
  React.ComponentProps<'button'>,
  'children' | 'type'
> {
  /** The accessible name of the icon, such as "Engine error". */
  label: string
  message: string
  /** The id of the alert, for the `aria-describedby` of the control with the error. */
  messageId?: string
  /** The side of the icon where the tooltip opens. */
  side?: 'top' | 'bottom'
}

/**
 * An error: a warning icon, with the message in a tooltip on hover and on
 * keyboard focus, and no text on the screen. The message is also an alert for
 * assistive technology, because it can come after the screen shows (WCAG 2.2
 * SC 4.1.3).
 */
export function ErrorMark({
  label,
  message,
  messageId,
  side = 'bottom',
  className,
  ...props
}: ErrorMarkProps) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={label}
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md text-destructive outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring',
                className,
              )}
              {...props}
            />
          }
        >
          <TriangleAlert className="size-icon" strokeWidth={1.75} aria-hidden />
        </TooltipTrigger>
        <TooltipContent side={side} align="start" className="wrap-anywhere">
          {message}
        </TooltipContent>
      </Tooltip>
      <p id={messageId} role="alert" className="sr-only">
        {message}
      </p>
    </>
  )
}
