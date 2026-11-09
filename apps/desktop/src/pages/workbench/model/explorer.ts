/** The git status of a file, as the Explorer shows it. */
export type GitStatus =
  'added' | 'modified' | 'deleted' | 'untracked' | 'conflict' | 'ignored'

export interface FileEntry {
  kind: 'file'
  id: string
  name: string
  status?: GitStatus
}

export interface FolderEntry {
  kind: 'folder'
  id: string
  name: string
  children: Entry[]
}

export type Entry = FileEntry | FolderEntry

/** A worktree of a repository: in vvorkflow, one worktree is one project. */
export interface Worktree {
  id: string
  branch: string
  /** The folder of the worktree, as the user sees it, for example `~/code/vvorkflow`. */
  path: string
  /** Whether the window works on this worktree now. */
  current?: boolean
  children: Entry[]
}

/** The worktrees of one repository, which the Explorer shows as one group. */
export interface RepositoryGroup {
  id: string
  name: string
  worktrees: Worktree[]
}

/** One row of the Explorer tree. */
export interface TreeNode {
  id: string
  kind: 'repository' | 'worktree' | 'folder' | 'file'
  label: string
  /** A second, muted text, for example the path of a worktree. */
  detail?: string
  /** The status of a file, or the most important status in a folder or a worktree. */
  status?: GitStatus
  current?: boolean
  children?: TreeNode[]
}

export const gitStatusLetters: Record<GitStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  untracked: 'U',
  conflict: 'C',
  ignored: 'I',
}

export const gitStatusNames: Record<GitStatus, string> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  untracked: 'untracked',
  conflict: 'conflict',
  ignored: 'ignored',
}

/** The order of importance, from the most important status. */
const importance: GitStatus[] = [
  'conflict',
  'deleted',
  'modified',
  'added',
  'untracked',
]

/**
 * Gives a folder the status of its contents.
 *
 * @returns The most important status of the children. A folder whose changed
 * children are all ignored is `ignored`. A folder with no status in it has none.
 */
export function rollUpStatus(
  statuses: (GitStatus | undefined)[],
): GitStatus | undefined {
  const present = statuses.filter(
    (status): status is GitStatus => status !== undefined,
  )
  if (present.length === 0) return undefined
  const top = importance.find((status) => present.includes(status))
  if (top) return top
  return present.length === statuses.length ? 'ignored' : undefined
}

function entryNode(entry: Entry): TreeNode {
  if (entry.kind === 'file') {
    return {
      id: entry.id,
      kind: 'file',
      label: entry.name,
      status: entry.status,
    }
  }
  const children = entry.children.map(entryNode)
  return {
    id: entry.id,
    kind: 'folder',
    label: entry.name,
    status: rollUpStatus(children.map((child) => child.status)),
    children,
  }
}

/** Turns the repository groups into the rows of the Explorer tree. */
export function toTreeNodes(groups: RepositoryGroup[]): TreeNode[] {
  return groups.map((group) => ({
    id: group.id,
    kind: 'repository',
    label: group.name,
    children: group.worktrees.map((worktree) => {
      const children = worktree.children.map(entryNode)
      return {
        id: worktree.id,
        kind: 'worktree',
        label: worktree.branch,
        detail: worktree.path,
        current: worktree.current,
        status: rollUpStatus(children.map((child) => child.status)),
        children,
      }
    }),
  }))
}

/** A row that the tree shows now, with its place in the tree. */
export interface VisibleRow {
  node: TreeNode
  level: number
  parentId?: string
  /** The place of the row among its siblings, from 1. */
  position: number
  /** The number of siblings, the row included. */
  siblings: number
}

/** Lists the rows that the tree shows, in order: the children of a collapsed node stay hidden. */
export function visibleRows(
  nodes: TreeNode[],
  expanded: ReadonlySet<string>,
  level = 1,
  parentId?: string,
): VisibleRow[] {
  return nodes.flatMap((node, index) => [
    { node, level, parentId, position: index + 1, siblings: nodes.length },
    ...(node.children && expanded.has(node.id)
      ? visibleRows(node.children, expanded, level + 1, node.id)
      : []),
  ])
}
