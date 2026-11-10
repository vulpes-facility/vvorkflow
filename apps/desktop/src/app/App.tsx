import { useEffect, useMemo } from 'react'
import { WorkbenchPage } from '@/pages/workbench'
import { currentWindowControls } from '@/shared/api'
import {
  applyColorScheme,
  detectPlatform,
  useSystemColorScheme,
} from '@/shared/lib'
import { useEngineExplorer } from './engine-explorer'
import { useEngineProjects } from './engine-projects'
import { useEngineTerminals } from './engine-terminals'

export function App() {
  const platform = useMemo(() => detectPlatform(navigator.userAgent), [])
  const windowControls = useMemo(() => currentWindowControls(), [])
  const colorScheme = useSystemColorScheme()
  const { repositories, explorer, onOpenFolder, openPath } = useEngineExplorer()
  const { projects, engineError, engineReady, createProject, stopEngine } =
    useEngineProjects()
  // A new terminal starts in the current worktree of the first repository,
  // or in the projects root.
  const worktree = repositories[0]?.worktrees.find(
    ({ current }) => current,
  )?.path
  const { terminals, newTerminal, killTerminal } = useEngineTerminals(
    engineReady,
    worktree,
  )

  useEffect(
    () => applyColorScheme(document.documentElement, colorScheme),
    [colorScheme],
  )

  return (
    <WorkbenchPage
      platform={platform}
      windowControls={windowControls}
      projects={projects}
      engineError={engineError}
      onOpenProject={(project) => openPath(project.id)}
      onCreateProject={
        createProject &&
        (async (name, signal) => {
          const project = await createProject(name)
          // The user closed the dialog before the answer: the project is in
          // the list, and does not open.
          if (!signal.aborted) openPath(project.path)
        })
      }
      repositories={repositories}
      terminals={terminals}
      onNewTerminal={newTerminal}
      onKillTerminal={killTerminal}
      onStopEngine={stopEngine}
      explorer={explorer}
      onOpenFolder={onOpenFolder}
    />
  )
}
