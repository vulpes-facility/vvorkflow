import { useQuery } from '@tanstack/react-query'
import type { WelcomeProject } from '@/pages/workbench'
import { hello, isTauri, listProjects } from '@/shared/api'

/**
 * The projects of the engine: it starts the connection with `hello`, then
 * lists the projects root, again each time the window gets the focus.
 *
 * @returns The projects in name order, and the message of the engine when it
 *   did not start or cannot read the root. Outside Tauri, no projects.
 */
export function useEngineProjects(): {
  projects: WelcomeProject[]
  engineError?: string
} {
  const welcome = useQuery({
    queryKey: ['engine', 'hello'],
    queryFn: hello,
    enabled: isTauri(),
    staleTime: Infinity,
  })
  const listed = useQuery({
    queryKey: ['engine', 'projects'],
    queryFn: listProjects,
    enabled: welcome.isSuccess,
  })
  return {
    projects: (listed.data ?? []).map(({ path, name, git }) => ({
      id: path,
      name,
      git,
    })),
    engineError: welcome.error?.message ?? listed.error?.message,
  }
}
