// Sample data for the stories and the screen capture. It never goes into `src/`.
// The handlers are Storybook spies (`fn`), so that the Actions panel shows each call.
import { ArrowDownUp, GitBranch, Laptop } from 'lucide-react'
import { fn } from 'storybook/test'
import type {
  StatusItem,
  WelcomeProject,
  WindowContext,
} from '../src/pages/workbench'
import type { WindowControls } from '../src/shared/api'

export const projects: WelcomeProject[] = [
  { id: '/home/me/vvorkflow/atlas-api', name: 'atlas-api', git: true },
  { id: '/home/me/vvorkflow/field-notes', name: 'field-notes', git: false },
  { id: '/home/me/vvorkflow/harbor-web', name: 'harbor-web', git: true },
  { id: '/home/me/vvorkflow/vvorkflow', name: 'vvorkflow', git: true },
]

/** Makes each project, as the engine does for a new name. */
export const createProject = fn(
  async (_name: string, _signal: AbortSignal) => {},
)

/** Refuses each project, as the engine does for a name that the root has already. */
export const refuseProject = fn((name: string, _signal: AbortSignal) =>
  Promise.reject<void>(new Error(`${name} is in the projects root already.`)),
)

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
