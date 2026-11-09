import { useEffect, useMemo } from 'react'
import { WorkbenchPage } from '@/pages/workbench'
import { currentWindowControls } from '@/shared/api'
import {
  applyColorScheme,
  detectPlatform,
  useSystemColorScheme,
} from '@/shared/lib'
import { useEngineExplorer } from './engine-explorer'

export function App() {
  const platform = useMemo(() => detectPlatform(navigator.userAgent), [])
  const windowControls = useMemo(() => currentWindowControls(), [])
  const colorScheme = useSystemColorScheme()
  const { repositories, explorer, onOpenFolder } = useEngineExplorer()

  useEffect(
    () => applyColorScheme(document.documentElement, colorScheme),
    [colorScheme],
  )

  return (
    <WorkbenchPage
      platform={platform}
      windowControls={windowControls}
      recentProjects={[]}
      repositories={repositories}
      explorer={explorer}
      onOpenFolder={onOpenFolder}
    />
  )
}
