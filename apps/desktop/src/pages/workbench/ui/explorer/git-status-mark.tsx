import { Minus, Plus, TriangleAlert } from 'lucide-react'
import { cn } from '@/shared/lib'
import type { GitStatus } from '../../model/explorer'

const icons = {
  added: Plus,
  untracked: Plus,
  deleted: Minus,
  conflict: TriangleAlert,
} as const

/**
 * The shape of a git status, beside its color, so that the color is not the
 * only sign (WCAG 2.2 SC 1.4.1): a plus for a new file, a dot for a change, a
 * minus for a deletion, and a warning for a conflict. An ignored file has no
 * mark; its name is in italics. The mark is decoration: the row tells the
 * status in its name.
 */
export function GitStatusMark({
  status,
  className,
}: {
  status: GitStatus
  className?: string
}) {
  if (status === 'ignored') return null
  const box = cn('flex size-4 shrink-0 items-center justify-center', className)
  if (status === 'modified') {
    return (
      <span aria-hidden data-git-status={status} className={box}>
        <span className="size-status-dot rounded-full bg-current" />
      </span>
    )
  }
  const Icon = icons[status]
  return (
    <span aria-hidden data-git-status={status} className={box}>
      <Icon className="size-icon-sm stroke-status" />
    </span>
  )
}
