import {
  ChevronRight,
  File,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib'
import {
  gitStatusLetters,
  gitStatusNames,
  visibleRows,
  type GitStatus,
  type TreeNode,
} from '../../model/explorer'

interface ExplorerTreeProps {
  /** The accessible name of the tree. */
  label: string
  nodes: TreeNode[]
  /** The ids of the nodes that are open at the start. */
  defaultExpanded?: string[]
  /** Opens a file, on a click or on Enter. */
  onOpenFile?: (id: string) => void
}

const statusText: Record<GitStatus, string> = {
  added: 'text-git-added',
  modified: 'text-git-modified',
  deleted: 'text-git-deleted',
  untracked: 'text-git-untracked',
  conflict: 'text-git-conflict',
  ignored: 'text-git-ignored',
}

/**
 * The tree of the Explorer view: repositories, their worktrees, and the
 * folders and files of each worktree. It follows the WAI-ARIA tree pattern:
 * one tab stop, the arrow keys move and open, Home and End jump, and Enter
 * opens. A row is the only control; its chevron is decoration.
 */
export function ExplorerTree({
  label,
  nodes,
  defaultExpanded = [],
  onOpenFile,
}: ExplorerTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(defaultExpanded),
  )
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [focusedId, setFocusedId] = useState<string | undefined>()
  const items = useRef(new Map<string, HTMLLIElement>())

  const rows = useMemo(() => visibleRows(nodes, expanded), [nodes, expanded])
  const activeId =
    focusedId && rows.some((row) => row.node.id === focusedId)
      ? focusedId
      : rows[0]?.node.id

  function toggle(id: string, open?: boolean) {
    setExpanded((current) => {
      const next = new Set(current)
      if (open ?? !next.has(id)) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function focus(id: string) {
    setFocusedId(id)
    setSelectedId(id)
    items.current.get(id)?.focus()
  }

  function activate(node: TreeNode) {
    if (node.children) toggle(node.id)
    else onOpenFile?.(node.id)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const index = rows.findIndex((row) => row.node.id === activeId)
    const row = rows[index]
    if (!row) return
    const { node } = row
    const isOpen = expanded.has(node.id)
    let handled = true
    switch (event.key) {
      case 'ArrowDown':
        if (rows[index + 1]) focus(rows[index + 1].node.id)
        break
      case 'ArrowUp':
        if (rows[index - 1]) focus(rows[index - 1].node.id)
        break
      case 'ArrowRight':
        if (node.children && !isOpen) toggle(node.id, true)
        else if (node.children?.[0]) focus(node.children[0].id)
        break
      case 'ArrowLeft':
        if (node.children && isOpen) toggle(node.id, false)
        else if (row.parentId) focus(row.parentId)
        break
      case 'Home':
        focus(rows[0].node.id)
        break
      case 'End':
        focus(rows[rows.length - 1].node.id)
        break
      case 'Enter':
        setSelectedId(node.id)
        activate(node)
        break
      case ' ':
        setSelectedId(node.id)
        break
      default:
        handled = false
    }
    if (handled) event.preventDefault()
  }

  // The rows are one flat list; aria-level, aria-setsize, and aria-posinset
  // tell the hierarchy. So each item takes its name from its own row only.
  return (
    <ul
      role="tree"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="py-1 select-none"
    >
      {rows.map(({ node, level, position, siblings }) => {
        const hasChildren = Boolean(node.children)
        const isOpen = expanded.has(node.id)
        return (
          <li
            key={node.id}
            ref={(element) => {
              if (element) items.current.set(node.id, element)
              else items.current.delete(node.id)
            }}
            role="treeitem"
            aria-level={level}
            aria-setsize={siblings}
            aria-posinset={position}
            aria-expanded={hasChildren ? isOpen : undefined}
            aria-selected={node.id === selectedId}
            tabIndex={node.id === activeId ? 0 : -1}
            onFocus={() => setFocusedId(node.id)}
            className="outline-none"
          >
            <Row
              node={node}
              level={level}
              isOpen={isOpen}
              hasChildren={hasChildren}
              onClick={() => {
                focus(node.id)
                activate(node)
              }}
            />
          </li>
        )
      })}
    </ul>
  )
}

const kindIcons: Record<TreeNode['kind'], LucideIcon> = {
  repository: FolderGit2,
  worktree: GitBranch,
  folder: Folder,
  file: File,
}

interface RowProps {
  node: TreeNode
  level: number
  isOpen: boolean
  hasChildren: boolean
  onClick: () => void
}

function Row({ node, level, isOpen, hasChildren, onClick }: RowProps) {
  const Icon =
    node.kind === 'folder' && isOpen ? FolderOpen : kindIcons[node.kind]
  const tint = node.status ? statusText[node.status] : undefined
  return (
    <div
      onClick={onClick}
      style={{ '--level': level } as React.CSSProperties}
      className={cn(
        'flex h-row items-center gap-1.5 pr-2 text-ui',
        'pl-[calc(var(--vv-tree-pad)+var(--vv-tree-indent)*(var(--level)-1))]',
        'hover:bg-hover',
        // The row shows the state of its tree item: selected, and focused.
        '[[aria-selected=true]>&]:bg-selection',
        '[li:focus-visible>&]:ring-1 [li:focus-visible>&]:ring-ring [li:focus-visible>&]:ring-inset',
      )}
    >
      <ChevronRight
        aria-hidden
        strokeWidth={1.75}
        className={cn(
          'size-icon-sm shrink-0 text-subtle-foreground',
          !hasChildren && 'invisible',
          isOpen && 'rotate-90',
        )}
      />
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className="size-icon shrink-0 text-subtle-foreground"
      />
      {/* The label keeps its full width while the row has space, and the
          path gives up its width first. A shrink of less than a pixel would
          already cut the label, so the label does not shrink at all. */}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span
          className={cn(
            'max-w-full shrink-0 truncate',
            tint ?? 'text-foreground',
            node.kind === 'repository' && 'font-semibold',
            node.current && 'font-medium',
          )}
        >
          {node.label}
        </span>
        {node.current && <span className="sr-only">, current worktree</span>}
        {node.detail && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {node.detail}
          </span>
        )}
      </span>
      {node.status && (
        <>
          <span
            aria-hidden
            className={cn(
              'w-4 shrink-0 text-center font-mono text-xs font-semibold',
              tint,
            )}
          >
            {gitStatusLetters[node.status]}
          </span>
          <span className="sr-only">
            ,{' '}
            {node.kind === 'file'
              ? gitStatusNames[node.status]
              : `contains ${gitStatusNames[node.status]} files`}
          </span>
        </>
      )}
    </div>
  )
}
