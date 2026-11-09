// Sample repositories for the stories and the screen capture. It never goes into `src/`.
import type { Entry, GitStatus, RepositoryGroup } from '../src/pages/workbench'

function file(id: string, name: string, status?: GitStatus): Entry {
  return { kind: 'file', id, name, status }
}

function folder(id: string, name: string, children: Entry[]): Entry {
  return { kind: 'folder', id, name, children }
}

export const repositories: RepositoryGroup[] = [
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
export const expandedPaths = [
  'vvorkflow',
  'vvorkflow/terminal-tabs',
  'tt/apps',
  'tt/apps/desktop',
  'tt/apps/desktop/src',
  'tt/apps/desktop/src/pages',
  'tt/apps/desktop/src/pages/workbench',
  'tt/dist',
  'atlas-api',
]
