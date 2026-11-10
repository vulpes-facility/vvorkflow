import { createContext, useContext } from 'react'

/** What the elements of a document read from the preview that holds them. */
export interface PreviewState {
  /** The scroll region of the preview. */
  region: React.RefObject<HTMLDivElement | null>
  /** A prefix for the ids of the footnotes, so that two previews do not share an id. */
  prefix: string
  remoteImages: boolean
  resolveImage?: (path: string) => string | undefined
  onOpenLink?: (url: string) => void
}

export const PreviewContext = createContext<PreviewState | null>(null)

/** The state of the preview that holds the element. */
export function usePreview(): PreviewState {
  const state = useContext(PreviewContext)
  if (!state) throw new Error('This element belongs in a MarkdownPreview.')
  return state
}
