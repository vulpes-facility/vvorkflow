import { useQueries, useQuery } from '@tanstack/react-query'
import { open } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import type { ExplorerRepository, ExplorerSource } from '@/pages/workbench'
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
 * folder that the user picks.
 *
 * @returns The repositories, without a repeat when two folders share one, the
 * source of the Explorer, and the action that asks the user for a folder.
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
  const paths = [...(startup.data ?? []), ...picked]
  const opened = useQueries({
    queries: paths.map((path) => ({
      queryKey: ['engine', 'open', path],
      queryFn: () => openFolder(path),
      staleTime: Infinity,
    })),
  })
  const seen = new Set<string>()
  const repositories: ExplorerRepository[] = []
  for (const { data } of opened) {
    const main = data?.worktrees[0]?.path
    if (!data || !main || seen.has(main)) continue
    seen.add(main)
    repositories.push(data)
  }

  async function openFromDialog() {
    const path = await open({ directory: true })
    if (typeof path === 'string')
      setPicked((current) =>
        current.includes(path) ? current : [...current, path],
      )
  }

  return {
    repositories,
    explorer: tauri ? engineSource : undefined,
    onOpenFolder: tauri ? () => void openFromDialog() : undefined,
  }
}
