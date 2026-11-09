// Sample repositories for the stories and the screen capture. It never goes into `src/`.
import {
  entryNodeId,
  repositoryNodeId,
  worktreeNodeId,
  type ChangedItem,
  type DirectoryItem,
  type ExplorerRepository,
  type ExplorerSource,
  type GitStatus,
} from '../src/pages/workbench'

/** A sample file or folder: the whole tree at once, as the engine never sends it. */
export type SampleEntry =
  | { kind: 'file'; id: string; name: string; status?: GitStatus }
  | { kind: 'folder'; id: string; name: string; children: SampleEntry[] }

export interface SampleRepository {
  id: string
  name: string
  worktrees: {
    id: string
    branch: string
    path: string
    current?: boolean
    children: SampleEntry[]
  }[]
}

function file(id: string, name: string, status?: GitStatus): SampleEntry {
  return { kind: 'file', id, name, status }
}

function folder(
  id: string,
  name: string,
  children: SampleEntry[],
): SampleEntry {
  return { kind: 'folder', id, name, children }
}

/** A chain of folders, `level-1` to `level-<depth>`, with one file at the end. */
function deepChain(depth: number): SampleEntry {
  let entry = file(`deep/${depth}/leaf`, 'leaf.txt')
  for (let level = depth; level >= 1; level--)
    entry = folder(`deep/${level}`, `level-${level}`, [entry])
  return entry
}

export const repositories: SampleRepository[] = [
  {
    id: 'vvorkflow',
    name: 'vvorkflow',
    worktrees: [
      {
        id: 'vvorkflow/terminal-tabs',
        branch: 'feat/terminal-tabs',
        path: '~/code/vvorkflow.terminal-tabs',
        current: true,
        children: [
          folder('tt/apps', 'apps', [
            folder('tt/apps/desktop', 'desktop', [
              folder('tt/apps/desktop/src', 'src', [
                folder('tt/apps/desktop/src/pages', 'pages', [
                  folder('tt/apps/desktop/src/pages/workbench', 'workbench', [
                    file('tt/terminal-tab.tsx', 'terminal-tab.tsx', 'added'),
                    file('tt/editor-area.tsx', 'editor-area.tsx', 'modified'),
                    file('tt/status-bar.tsx', 'status-bar.tsx'),
                  ]),
                ]),
                file('tt/merge-notes.md', 'merge-notes.md', 'conflict'),
                file('tt/old-shell.tsx', 'old-shell.tsx', 'deleted'),
              ]),
              file('tt/package.json', 'package.json', 'modified'),
            ]),
          ]),
          folder('tt/dist', 'dist', [
            file('tt/dist/index.js', 'index.js', 'ignored'),
          ]),
          file('tt/scratch.md', 'scratch.md', 'untracked'),
          file('tt/README.md', 'README.md'),
        ],
      },
      {
        id: 'vvorkflow/main',
        branch: 'main',
        path: '~/code/vvorkflow',
        children: [file('m/README.md', 'README.md')],
      },
      {
        id: 'vvorkflow/explorer',
        branch: 'feat/explorer',
        path: '~/code/vvorkflow.explorer',
        children: [
          deepChain(30),
          file('ex/explorer-tree.tsx', 'explorer-tree.tsx', 'modified'),
        ],
      },
    ],
  },
  {
    id: 'atlas-api',
    name: 'atlas-api',
    worktrees: [
      {
        id: 'atlas/main',
        branch: 'main',
        path: '~/code/atlas/api',
        children: [file('at/go.mod', 'go.mod')],
      },
      {
        id: 'atlas/orders',
        branch: 'fix/order-cancel',
        path: '~/code/atlas/api.order-cancel',
        children: [file('at/cancel.go', 'cancel.go', 'modified')],
      },
      {
        id: 'atlas/billing',
        branch: 'feat/billing',
        path: '~/code/atlas/api.billing',
        children: [file('at/billing.go', 'billing.go', 'added')],
      },
    ],
  },
]

/** The nodes that the Explorer story shows open: the current worktree, down to the deep folder. */
const current = '~/code/vvorkflow.terminal-tabs'
export const expandedPaths = [
  repositoryNodeId({
    name: 'vvorkflow',
    git: true,
    worktrees: [{ path: current }],
  }),
  worktreeNodeId(current),
  ...[
    'apps',
    'apps/desktop',
    'apps/desktop/src',
    'apps/desktop/src/pages',
    'apps/desktop/src/pages/workbench',
    'dist',
  ].map((folder) => entryNodeId(current, folder)),
  repositoryNodeId({
    name: 'atlas-api',
    git: true,
    worktrees: [{ path: '~/code/atlas/api' }],
  }),
]

/** The repositories of the samples, as the engine sends them when it opens a folder. */
export function sampleRepositories(
  samples: SampleRepository[],
): ExplorerRepository[] {
  return samples.map((sample) => ({
    name: sample.name,
    git: true,
    worktrees: sample.worktrees.map(({ path, branch, current }) => ({
      path,
      branch,
      current,
    })),
  }))
}

/**
 * A source that serves the samples as the engine would: one folder at a time,
 * and the changed paths of a worktree. A folder whose files are all ignored is
 * one ignored path that ends with `/`, as git reports it.
 *
 * The id stays the same for new samples, so the queries keep their answers
 * until they read again.
 */
export function sampleSource(samples: SampleRepository[]): ExplorerSource {
  const worktree = (path: string) =>
    samples
      .flatMap((sample) => sample.worktrees)
      .find((candidate) => candidate.path === path)
  return {
    id: 'sample',
    listDirectory: (path, relative) => {
      let entries = worktree(path)?.children ?? []
      for (const name of relative.split('/').filter(Boolean)) {
        const next = entries.find((entry) => entry.name === name)
        entries = next?.kind === 'folder' ? next.children : []
      }
      return Promise.resolve(
        entries.map(({ name, kind }): DirectoryItem => ({ name, kind })),
      )
    },
    readStatus: (path) => {
      const changes: ChangedItem[] = []
      const walk = (entries: SampleEntry[], prefix: string) => {
        for (const entry of entries) {
          const relative = prefix + entry.name
          if (entry.kind === 'file') {
            if (entry.status)
              changes.push({ path: relative, status: entry.status })
          } else if (
            entry.children.length > 0 &&
            entry.children.every(
              (child) => child.kind === 'file' && child.status === 'ignored',
            )
          ) {
            changes.push({ path: `${relative}/`, status: 'ignored' })
          } else {
            walk(entry.children, `${relative}/`)
          }
        }
      }
      walk(worktree(path)?.children ?? [], '')
      return Promise.resolve(changes)
    },
  }
}
