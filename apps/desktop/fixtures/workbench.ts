// Sample data for the stories and the screen capture. It never goes into `src/`.
// The handlers are Storybook spies (`fn`), so that the Actions panel shows each call.
import { ArrowDownUp, GitBranch, Laptop } from 'lucide-react'
import { fn } from 'storybook/test'
import type {
  RecentProject,
  StatusItem,
  WindowContext,
} from '../src/pages/workbench'
import type { WindowControls } from '../src/shared/api'

export const recentProjects: RecentProject[] = [
  {
    id: 'vvorkflow',
    name: 'vvorkflow',
    path: '~/code/vvorkflow',
    worktrees: 4,
  },
  {
    id: 'atlas-api',
    name: 'atlas-api',
    path: '~/code/atlas/api',
    worktrees: 2,
  },
  {
    id: 'harbor-web',
    name: 'harbor-web',
    path: '~/code/harbor/web',
    worktrees: 3,
  },
  {
    id: 'field-notes',
    name: 'field-notes',
    path: '~/Documents/field-notes',
    worktrees: 1,
  },
]

export const windowContext: WindowContext = {
  project: 'vvorkflow',
  branch: 'feat/terminal-tabs',
}

export const status: { start: StatusItem[]; end: StatusItem[] } = {
  start: [
    {
      id: 'branch',
      label: 'feat/terminal-tabs',
      icon: GitBranch,
      description: 'The branch of the active worktree',
      onClick: fn(),
    },
    {
      id: 'sync',
      label: '0↓ 2↑',
      icon: ArrowDownUp,
      description: 'Commits to pull and to push',
    },
  ],
  end: [
    {
      id: 'engine',
      label: 'Local',
      icon: Laptop,
      description: 'The engine runs on this computer',
    },
  ],
}

/** Window controls that do nothing, for a window outside Tauri. */
export const windowControls: WindowControls = {
  minimize: fn(),
  toggleMaximize: fn(),
  close: fn(),
  watchMaximized: (listener) => {
    listener(false)
    return () => {}
  },
}
