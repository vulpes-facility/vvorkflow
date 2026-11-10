import { Square, SquareCheck } from 'lucide-react'
import { cn } from '@/shared/lib'
import { classifyLinkTarget } from '../../model/markdown-urls'
import { usePreview } from './preview-context'

type Props<T extends keyof React.JSX.IntrinsicElements> = Omit<
  React.ComponentProps<T>,
  'node' | 'ref'
> & { node?: unknown }

/** Moves to an element inside the preview: it scrolls the region, and moves the focus. */
function goTo(region: HTMLElement | null, id: string) {
  const target = region?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
  if (!region || !target) return
  const offset =
    target.getBoundingClientRect().top - region.getBoundingClientRect().top
  region.scrollTop += offset - 16
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1
  target.focus({ preventScroll: true })
}

export function Link({ node: _node, href, children, ...props }: Props<'a'>) {
  const { region, prefix, onOpenLink } = usePreview()
  const target = classifyLinkTarget(href ?? '')
  // A link that the preview does not follow is plain text.
  if (target.kind === 'blocked' || !href) return <span>{children}</span>
  // The label of the footnotes has an id that the preview makes its own.
  const describedBy = props['aria-describedby']
  return (
    <a
      {...props}
      href={href}
      aria-describedby={describedBy ? `${prefix}${describedBy}` : undefined}
      // An inline link is exempt from the target size (WCAG 2.2 SC 2.5.8).
      data-inline-link
      onClick={(event) => {
        // The preview never navigates by itself.
        event.preventDefault()
        if (target.kind === 'anchor') goTo(region.current, target.id)
        else onOpenLink?.(target.url)
      }}
      onAuxClick={(event) => event.preventDefault()}
      className="rounded-sm text-link underline underline-offset-2 outline-none hover:decoration-2 focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </a>
  )
}

const headingStyle = {
  1: 'mb-4 border-b border-border pb-2 text-2xl font-semibold tracking-display',
  2: 'mb-3 border-b border-border pb-1.5 text-xl font-semibold',
  3: 'mb-2 text-lg font-semibold',
  4: 'mb-2 text-sm font-semibold',
  5: 'mb-2 text-sm font-semibold text-muted-foreground',
  6: 'mb-2 text-xs font-semibold text-muted-foreground',
} as const

export function Heading({
  level,
  node: _node,
  id,
  className,
  ...props
}: Props<'h1'> & { level: keyof typeof headingStyle }) {
  const { prefix } = usePreview()
  const Tag = `h${level}` as const
  // The label of the footnotes keeps its id, with the prefix of this preview.
  const labelId = id === 'footnote-label' ? `${prefix}${id}` : id
  return (
    <Tag
      {...props}
      id={labelId}
      className={cn(
        'mt-8 leading-snug first:mt-0',
        level >= 4 && 'mt-5',
        headingStyle[level],
        className?.includes('sr-only') && 'sr-only',
      )}
    />
  )
}

export function Checkbox({ node: _node, checked, type }: Props<'input'>) {
  // A task list is read-only: a shape and a name in place of a disabled input.
  if (type !== 'checkbox') return null
  const Icon = checked ? SquareCheck : Square
  return (
    <span
      role="img"
      aria-label={checked ? 'Done' : 'Not done'}
      className="mr-2 inline-flex align-text-bottom"
    >
      <Icon
        className="size-icon text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden
      />
    </span>
  )
}
