import { useQueries, useQuery } from '@tanstack/react-query'
import { open } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { uniqueRepositories, type ExplorerSource } from '@/pages/workbench'
import {
  isTauri,
  listDirectory,
  openFolder,
  readStatus,
  startupFolders,
} from '@/shared/api'

/** The Explorer reads the folders and the git status from the engine. */
const engineSource: ExplorerSource = {
  id: 'engine',
  listDirectory,
  readStatus,
}

/**
 * The folders that the engine opened: those of the command line, then each
 * folder that the user picks or opens from the projects.
 *
 * @returns The repositories, without a repeat when two folders share one, the
 * source of the Explorer, the action that asks the user for a folder, and the
 * action that opens a path.
 */
export function useEngineExplorer() {
  const tauri = isTauri()
  const startup = useQuery({
    queryKey: ['engine', 'startup'],
    queryFn: startupFolders,
    enabled: tauri,
    staleTime: Infinity,
  })
  const [picked, setPicked] = useState<string[]>([])
  const openPath = (path: string) =>
    setPicked((current) =>
      current.includes(path) ? current : [...current, path],
    )
  const paths = [...(startup.data ?? []), ...picked]
  const opened = useQueries({
    queries: paths.map((path) => ({
      queryKey: ['engine', 'open', path],
      queryFn: () => openFolder(path),
      staleTime: Infinity,
    })),
  })
  const repositories = uniqueRepositories(opened.map(({ data }) => data))

  async function openFromDialog() {
    const path = await open({ directory: true })
    if (typeof path === 'string') openPath(path)
  }

  return {
    repositories,
    explorer: tauri ? engineSource : undefined,
    onOpenFolder: tauri ? () => void openFromDialog() : undefined,
    openPath,
  }
}
