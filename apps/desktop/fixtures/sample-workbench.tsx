// The workbench with sample repositories, for the stories. It never goes into `src/`.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, type ComponentProps } from 'react'
import { WorkbenchPage } from '../src/pages/workbench'
import {
  sampleRepositories,
  sampleSource,
  type SampleRepository,
} from './repositories'

export type SampleWorkbenchProps = Omit<
  ComponentProps<typeof WorkbenchPage>,
  'repositories' | 'explorer'
> & { repositories?: SampleRepository[] }

/**
 * The workbench page, with the sample repositories served as the engine would.
 * A change of the samples, as a story test makes it, reaches the Explorer like
 * an update from the engine: the queries read again.
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
  return (
    <WorkbenchPage
      {...props}
      repositories={repositories ? opened : undefined}
      explorer={repositories ? source : undefined}
    />
  )
}
