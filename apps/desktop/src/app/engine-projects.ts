import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { WelcomeProject } from '@/pages/workbench'
import {
  createProject,
  hello,
  isTauri,
  listProjects,
  otherEngine,
  stopEngine,
  type Project,
} from '@/shared/api'

/**
 * The projects of the engine: it starts the connection with `hello`, then
 * lists the projects root, again each time the window gets the focus.
 *
 * @returns The projects in name order, the message of the engine when it
 *   did not start or cannot read the root, and, when the engine answers, the
 *   action that makes a project and lists the projects again. When `hello`
 *   fails and an engine of another version listens, which keeps its place
 *   because it has terminal sessions, also the action that stops that engine
 *   and starts again. Outside Tauri, no projects and no action.
 */
export function useEngineProjects(): {
  projects: WelcomeProject[]
  engineError?: string
  /** True when the engine answered `hello`. */
  engineReady: boolean
  createProject?: (name: string) => Promise<Project>
  stopEngine?: () => void
} {
  const queryClient = useQueryClient()
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
  const other = useQuery({
    queryKey: ['engine', 'other'],
    queryFn: otherEngine,
    enabled: welcome.isError,
  })
  return {
    engineReady: welcome.isSuccess,
    stopEngine:
      welcome.isError && other.data
        ? () =>
            void stopEngine()
              // The engine that does not stop tells why in the next `hello`.
              .catch(() => {})
              .then(() =>
                queryClient.invalidateQueries({ queryKey: ['engine'] }),
              )
        : undefined,
    projects: (listed.data ?? []).map(({ path, name, git }) => ({
      id: path,
      name,
      git,
    })),
    engineError: welcome.error?.message ?? listed.error?.message,
    createProject: welcome.isSuccess
      ? async (name) => {
          const project = await createProject(name)
          void queryClient.invalidateQueries({
            queryKey: ['engine', 'projects'],
          })
          return project
        }
      : undefined,
  }
}
