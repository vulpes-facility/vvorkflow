/** The git status of a path, as the Explorer shows it. */
export type GitStatus =
  'added' | 'modified' | 'deleted' | 'untracked' | 'conflict' | 'ignored'

/** One worktree of a repository: in vvorkflow, one worktree is one project. */
export interface ExplorerWorktree {
  /** The absolute path of the worktree on the machine of the engine. */
  path: string
  /** The checked-out branch; none for a detached HEAD or a plain folder. */
  branch?: string | null
  /** Whether the window works on this worktree now. */
  current?: boolean
}

/** An open folder: a repository and its worktrees, or a plain folder. */
export interface ExplorerRepository {
  name: string
  /** False for a plain folder, which has no git status. */
  git: boolean
  worktrees: ExplorerWorktree[]
}

export interface DirectoryItem {
  name: string
  kind: 'file' | 'folder'
}

/**
 * A path with a git status, relative to its worktree. A folder that git
 * reports as a whole, such as an ignored folder, ends with `/`.
 */
export interface ChangedItem {
  path: string
  status: GitStatus
}

/**
 * Where the Explorer reads the folders and the git status: the engine in the
 * app, or sample data in the stories. Queries keep their answers under `id`,
 * so a new source with a new id reads everything again.
 */
export interface ExplorerSource {
  id: string
  listDirectory: (worktree: string, path: string) => Promise<DirectoryItem[]>
  readStatus: (worktree: string) => Promise<ChangedItem[]>
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
  /** Whether the row can open; a folder that is not read yet can. */
  expandable: boolean
  /** The rows in it, when they are known. */
  children?: TreeNode[]
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
 * Finds the status of a path from the changed paths of its worktree.
 *
 * @param path The path relative to the worktree; empty for the worktree.
 * @returns For a file, its own status. For a folder, the most important
 * status of the folder itself, such as a changed submodule, and of the paths
 * in it, without the ignored ones. A path in a folder that
 * git reports as a whole, or that folder itself, has the status of the folder.
 * A path with no change has none.
 */
export function pathStatus(
  changes: readonly ChangedItem[] | undefined,
  path: string,
  folder: boolean,
): GitStatus | undefined {
  if (!changes) return undefined
  const asFolder = `${path}/`
  const whole = changes.find(
    (change) =>
      path !== '' &&
      change.path.endsWith('/') &&
      (folder ? asFolder : path).startsWith(change.path),
  )
  if (whole) return whole.status
  if (!folder) return changes.find((change) => change.path === path)?.status
  const prefix = path === '' ? '' : asFolder
  const inside = new Set(
    changes
      .filter(
        (change) =>
          (change.path === path || change.path.startsWith(prefix)) &&
          change.status !== 'ignored',
      )
      .map((change) => change.status),
  )
  return importance.find((status) => inside.has(status))
}

/** The id of the row of a repository. */
export function repositoryNodeId(repository: ExplorerRepository): string {
  return `repository:${repository.worktrees[0]?.path ?? repository.name}`
}

/** A folder that the tree shows open, and that it has to read. */
export interface FolderToRead {
  worktree: string
  path: string
}

/**
 * Builds the rows of the Explorer from what is read so far.
 *
 * @param folders Gives the entries of a folder, or undefined when it is not
 * read yet.
 * @param changes Gives the changed paths of a worktree, or undefined when they
 * are not read yet, or for a plain folder.
 * @returns The tree, and each open folder that is not read yet. A folder is
 * read only when it is open and each folder above it is open, so a large
 * folder costs nothing until the user opens it.
 */
export function buildTree(
  repositories: readonly ExplorerRepository[],
  expanded: ReadonlySet<string>,
  folders: (worktree: string, path: string) => DirectoryItem[] | undefined,
  changes: (worktree: string) => readonly ChangedItem[] | undefined,
): { nodes: TreeNode[]; toRead: FolderToRead[] } {
  const toRead: FolderToRead[] = []

  function entries(worktree: string, path: string): TreeNode[] | undefined {
    const items = folders(worktree, path)
    if (!items) {
      toRead.push({ worktree, path })
      return undefined
    }
    const changed = changes(worktree)
    return items.map((item) => {
      const relative = path === '' ? item.name : `${path}/${item.name}`
      const id = `${worktree}/${relative}`
      const folder = item.kind === 'folder'
      const children =
        folder && expanded.has(id) ? entries(worktree, relative) : undefined
      return {
        id,
        kind: item.kind,
        label: item.name,
        status: pathStatus(changed, relative, folder),
        expandable: folder && (children === undefined || children.length > 0),
        children,
      }
    })
  }

  const nodes = repositories.map((repository): TreeNode => {
    const id = repositoryNodeId(repository)
    const worktrees = expanded.has(id)
      ? repository.worktrees.map((worktree): TreeNode => {
          const children = expanded.has(worktree.path)
            ? entries(worktree.path, '')
            : undefined
          return {
            id: worktree.path,
            kind: 'worktree',
            // A detached HEAD or a plain folder has no branch: show its folder.
            label: worktree.branch ?? worktree.path.split('/').pop() ?? '',
            detail: worktree.path,
            current: worktree.current,
            status: pathStatus(changes(worktree.path), '', true),
            expandable: children === undefined || children.length > 0,
            children,
          }
        })
      : undefined
    return {
      id,
      kind: 'repository',
      label: repository.name,
      expandable: repository.worktrees.length > 0,
      children: worktrees,
    }
  })
  return { nodes, toRead }
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
    ...(node.expandable && node.children && expanded.has(node.id)
      ? visibleRows(node.children, expanded, level + 1, node.id)
      : []),
  ])
}

/**
 * Finds the row that takes the focus when the focused row leaves the tree,
 * for example when its file is deleted or an update collapses its folder.
 * It is the next sibling that is still visible, or else the previous one, or
 * else the nearest ancestor that is still visible.
 *
 * @param previous The rows before the change.
 * @param next The rows after the change.
 * @param id The id of the row that left.
 */
export function survivingRow(
  previous: VisibleRow[],
  next: VisibleRow[],
  id: string,
): string | undefined {
  const visible = new Set(next.map((row) => row.node.id))
  const byId = new Map(previous.map((row) => [row.node.id, row]))
  const removed = byId.get(id)
  if (!removed) return next[0]?.node.id
  const siblings = previous.filter((row) => row.parentId === removed.parentId)
  const at = siblings.indexOf(removed)
  const sibling =
    siblings.slice(at + 1).find((row) => visible.has(row.node.id)) ??
    siblings
      .slice(0, at)
      .reverse()
      .find((row) => visible.has(row.node.id))
  if (sibling) return sibling.node.id
  for (
    let parentId = removed.parentId;
    parentId;
    parentId = byId.get(parentId)?.parentId
  ) {
    if (visible.has(parentId)) return parentId
  }
  return next[Math.min(previous.indexOf(removed), next.length - 1)]?.node.id
}
