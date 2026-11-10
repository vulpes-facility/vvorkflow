// The workbench with sample repositories, for the stories. It never goes into `src/`.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import { WorkbenchPage } from '../src/pages/workbench'
import {
  sampleRepositories,
  sampleSource,
  type SampleRepository,
} from './repositories'
import { newTerminal } from './terminals'

export type SampleWorkbenchProps = Omit<
  ComponentProps<typeof WorkbenchPage>,
  'repositories' | 'explorer'
> & { repositories?: SampleRepository[] }

/**
 * The workbench page, with the sample repositories served as the engine would.
 * A change of the samples, as a story test makes it, reaches the Explorer like
 * an update from the engine: the queries read again. It keeps the terminal
 * sessions as the engine does: New terminal adds a session, and Kill takes
 * one away. Stop engine takes the engine error away, as a new engine does.
 */
export function SampleWorkbench({
  repositories,
  ...props
}: SampleWorkbenchProps) {
  const queryClient = useQueryClient()
  const source = useMemo(() => sampleSource(repositories ?? []), [repositories])
  // The queries keep their keys, so they show the old answers until they
  // read the new samples.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['explorer'] })
  }, [source, queryClient])
  const opened = useMemo(
    () => sampleRepositories(repositories ?? []),
    [repositories],
  )
  const {
    terminals,
    engineError,
    onNewTerminal,
    onKillTerminal,
    onStopEngine,
  } = props
  const [sessions, setSessions] = useState(terminals)
  const [added, setAdded] = useState(0)
  const [stopped, setStopped] = useState(false)
  // New args of the story replace the sessions, as a new list of the engine.
  const [known, setKnown] = useState(terminals)
  if (known !== terminals) {
    setKnown(terminals)
    setSessions(terminals)
  }
  return (
    <WorkbenchPage
      {...props}
      repositories={repositories ? opened : undefined}
      explorer={repositories ? source : undefined}
      terminals={sessions}
      engineError={stopped ? undefined : engineError}
      onNewTerminal={
        onNewTerminal &&
        (() => {
          onNewTerminal()
          setSessions((current) => [...(current ?? []), newTerminal(added + 1)])
          setAdded(added + 1)
        })
      }
      onKillTerminal={
        onKillTerminal &&
        ((id) => {
          onKillTerminal(id)
          setSessions((current) => current?.filter((one) => one.id !== id))
        })
      }
      onStopEngine={
        onStopEngine &&
        (() => {
          onStopEngine()
          setStopped(true)
        })
      }
    />
  )
}
