import { Square, SquareCheck } from 'lucide-react'
import { cn } from '@/shared/lib'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui'
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

/**
 * A link of the document. It is a link for assistive technology (role `link`,
 * in the tab order, Enter activates it), but it has no `href`, so that the
 * browser has no destination to follow: a click with a modifier key, a middle
 * click, a drag and drop onto the window, and the context menu cannot open or
 * load it. The destination is data (`data-href`, and the tooltip of an
 * external link). The preview itself acts on an activation: it moves inside
 * the preview, or it calls `onOpenLink`.
 */
export function Link({
  node: _node,
  href,
  children,
  className: _className,
  ...props
}: Props<'a'>) {
  const { region, prefix, onOpenLink } = usePreview()
  const target = classifyLinkTarget(href ?? '')
  // A link that the preview does not follow is plain text.
  if (target.kind === 'blocked' || !href) return <span>{children}</span>
  // The label of the footnotes has an id that the preview makes its own.
  const describedBy = props['aria-describedby']
  // A link that stands alone in its block gets a target of 24 by 24 pixels.
  const inline = (props as Record<string, unknown>)['data-inline-link']
  const activate = () => {
    if (target.kind === 'anchor') goTo(region.current, target.id)
    else onOpenLink?.(target.url)
  }
  const link = (
    <a
      {...props}
      role="link"
      tabIndex={0}
      data-href={href}
      aria-describedby={describedBy ? `${prefix}${describedBy}` : undefined}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault()
        activate()
      }}
      onAuxClick={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        activate()
      }}
      className={cn(
        'cursor-pointer rounded-sm text-link underline underline-offset-2 outline-none hover:decoration-2 focus-visible:ring-1 focus-visible:ring-ring',
        !inline && 'inline-flex min-h-6 min-w-6 items-center justify-center',
      )}
    >
      {children}
    </a>
  )
  if (target.kind === 'anchor') return link
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent
        side="top"
        align="start"
        className="font-mono wrap-anywhere"
      >
        {target.url}
      </TooltipContent>
    </Tooltip>
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
