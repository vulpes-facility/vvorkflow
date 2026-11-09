import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  buildTree,
  repositoryNodeId,
  worktreeNodeId,
  type DirectoryItem,
  type ExplorerRepository,
  type ExplorerSource,
  type FolderToRead,
} from '../../model/explorer'
import { ExplorerTree } from './explorer-tree'

interface ExplorerViewProps {
  /** The accessible name of the tree. */
  label: string
  repositories: ExplorerRepository[]
  source: ExplorerSource
  /**
   * The ids of the nodes that are open at the start. Without them, each
   * repository and its current worktree open when they appear.
   */
  defaultExpanded?: string[]
  onOpenFile?: (id: string) => void
}

/** The ids that open by default for a repository that appears. */
function opened(repository: ExplorerRepository) {
  return [
    repositoryNodeId(repository),
    ...repository.worktrees
      .filter((worktree) => worktree.current)
      .map((worktree) => worktreeNodeId(worktree.path)),
  ]
}

const folderKey = ({ worktree, path }: FolderToRead) => `${worktree}\0${path}`

/**
 * The Explorer: the tree of the open repositories. It reads a folder only
 * when the user opens it, and the git status of each worktree, from the
 * source, through the query cache.
 */
export function ExplorerView({
  label,
  repositories,
  source,
  defaultExpanded,
  onOpenFile,
}: ExplorerViewProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(defaultExpanded ?? repositories.flatMap(opened)),
  )
  // A repository that appears later opens with its current worktree.
  const [known, setKnown] = useState(repositories)
  if (known !== repositories) {
    setKnown(repositories)
    if (!defaultExpanded) {
      const before = new Set(known.map(repositoryNodeId))
      const added = repositories.filter(
        (repository) => !before.has(repositoryNodeId(repository)),
      )
      if (added.length > 0)
        setExpanded(new Set([...expanded, ...added.flatMap(opened)]))
    }
  }

  const statuses = useQueries({
    queries: repositories
      .filter((repository) => repository.git)
      .flatMap((repository) => repository.worktrees)
      .map((worktree) => ({
        queryKey: ['explorer', source.id, 'status', worktree.path],
        queryFn: () => source.readStatus(worktree.path),
      })),
  })
  const gitWorktrees = repositories
    .filter((repository) => repository.git)
    .flatMap((repository) => repository.worktrees.map(({ path }) => path))

  // The folders to read are the open ones that the tree reaches; the tree
  // reaches more of them after each answer. A folder that the cache already
  // has counts at once, so a deep branch that opens again takes one pass.
  const queryClient = useQueryClient()
  const directoryKey = (folder: FolderToRead) => [
    'explorer',
    source.id,
    'directory',
    folder.worktree,
    folder.path,
  ]
  const [wanted, setWanted] = useState<FolderToRead[]>([])
  const folders = useQueries({
    queries: wanted.map((folder) => ({
      queryKey: directoryKey(folder),
      queryFn: () => source.listDirectory(folder.worktree, folder.path),
    })),
  })
  const read = new Map<string, DirectoryItem[] | undefined>(
    wanted.map((folder, index) => [folderKey(folder), folders[index]?.data]),
  )
  const reached: FolderToRead[] = []
  const { nodes } = buildTree(
    repositories,
    expanded,
    (worktree, path) => {
      const folder = { worktree, path }
      reached.push(folder)
      return (
        read.get(folderKey(folder)) ??
        queryClient.getQueryData<DirectoryItem[]>(directoryKey(folder))
      )
    },
    (worktree) => statuses[gitWorktrees.indexOf(worktree)]?.data,
  )
  const reachedKeys = reached.map(folderKey).join('\0')
  if (reachedKeys !== wanted.map(folderKey).join('\0')) setWanted(reached)

  return (
    <ExplorerTree
      label={label}
      nodes={nodes}
      expanded={expanded}
      onExpandedChange={setExpanded}
      onOpenFile={onOpenFile}
    />
  )
}
