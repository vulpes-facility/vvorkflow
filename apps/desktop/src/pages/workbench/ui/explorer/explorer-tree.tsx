import {
  ChevronRight,
  File,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib'
import {
  gitStatusLetters,
  gitStatusNames,
  survivingRow,
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
  // The item that has the focus, until the focus leaves the tree.
  const focusedItem = useRef<HTMLElement | null>(null)

  const rows = useMemo(() => visibleRows(nodes, expanded), [nodes, expanded])

  // When an update takes away the focused row, the focus and the selection
  // move to the nearest row that is left.
  const [previousRows, setPreviousRows] = useState(rows)
  if (rows !== previousRows) {
    setPreviousRows(rows)
    const visible = new Set(rows.map((row) => row.node.id))
    if (focusedId && !visible.has(focusedId)) {
      const survivor = survivingRow(previousRows, rows, focusedId)
      setFocusedId(survivor)
      if (selectedId === focusedId) setSelectedId(survivor)
    } else if (selectedId && !visible.has(selectedId)) {
      setSelectedId(undefined)
    }
  }
  const activeId =
    focusedId && rows.some((row) => row.node.id === focusedId)
      ? focusedId
      : rows[0]?.node.id

  // The removed item took the focus with it, so give the focus to its survivor.
  useEffect(() => {
    const item = focusedItem.current
    if (!item || item.isConnected || !activeId) return
    if (document.activeElement && document.activeElement !== document.body)
      return
    items.current.get(activeId)?.focus()
  }, [rows, activeId])

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
    if (node.kind === 'file') onOpenFile?.(node.id)
    else if (node.children?.length) toggle(node.id)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const index = rows.findIndex((row) => row.node.id === activeId)
    const row = rows[index]
    if (!row) return
    const { node } = row
    const hasChildren = Boolean(node.children?.length)
    const isOpen = hasChildren && expanded.has(node.id)
    let handled = true
    switch (event.key) {
      case 'ArrowDown':
        if (rows[index + 1]) focus(rows[index + 1].node.id)
        break
      case 'ArrowUp':
        if (rows[index - 1]) focus(rows[index - 1].node.id)
        break
      case 'ArrowRight':
        if (hasChildren && !isOpen) toggle(node.id, true)
        else if (isOpen && node.children?.[0]) focus(node.children[0].id)
        break
      case 'ArrowLeft':
        if (isOpen) toggle(node.id, false)
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
        // An empty folder has nothing to open, so it has no expanded state.
        const hasChildren = Boolean(node.children?.length)
        const isOpen = hasChildren && expanded.has(node.id)
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
            onFocus={(event) => {
              focusedItem.current = event.currentTarget
              setFocusedId(node.id)
            }}
            onBlur={(event) => {
              // A removed item also loses the focus; only an item that is
              // still there lost it to the user.
              const item = event.currentTarget
              queueMicrotask(() => {
                if (item.isConnected && focusedItem.current === item)
                  focusedItem.current = null
              })
            }}
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
        'tree-inset',
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
