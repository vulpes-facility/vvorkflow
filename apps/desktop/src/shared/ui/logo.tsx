import { cn } from '../lib'

/** The vvorkflow mark: two chevrons that meet at the top, "vv" read as "w". The second one takes the accent color. */
export function LogoMark({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('size-6', className)}
      {...props}
    >
      <path d="M2.5 6 7.25 18 12 6" className="stroke-current" />
      <path d="M12 6 16.75 18 21.5 6" className="stroke-indicator" />
    </svg>
  )
}
