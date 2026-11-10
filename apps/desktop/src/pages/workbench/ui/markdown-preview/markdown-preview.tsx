import { ImageDown } from 'lucide-react'
import { useId, useMemo, useRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { IconButton } from '@/shared/ui'
import { markInlineLinks } from '../../model/markdown-links'
import { countRemoteImages } from '../../model/markdown-urls'
import { markdownComponents } from './markdown-components'
import { PreviewContext, type PreviewState } from './preview-context'

/** The props of the Markdown preview. */
export interface MarkdownPreviewProps {
  /** The Markdown text of the document. */
  text: string
  /**
   * Gives the URL that shows a local image, from its path as the document
   * wrote it. Without it, or when it returns undefined, a local image is a
   * placeholder.
   */
  resolveImage?: (path: string) => string | undefined
  /**
   * True shows the remote images (http and https). False shows a placeholder
   * in the place of each one, and makes no request.
   */
  remoteImages: boolean
  /**
   * Called when the user allows the remote images of this document. Without
   * it, the preview has no control to allow them.
   */
  onAllowRemoteImages?: () => void
  /**
   * Called with the URL of a link that the user activates. The preview never
   * navigates by itself.
   */
  onOpenLink?: (url: string) => void
}

/**
 * The Markdown preview of a document, as a tab of the editor area.
 *
 * - GitHub Flavored Markdown: tables, task lists (read-only), strikethrough,
 *   autolinks, and footnotes. A footnote link scrolls and moves the focus
 *   inside the preview, and does not change the URL of the window.
 * - The preview removes raw HTML, so a script, a frame, a style, and an event
 *   handler have no effect. A link with a scheme other than `http`, `https`,
 *   or `mailto` is plain text. It never navigates by itself: it calls
 *   `onOpenLink`.
 * - A remote image makes no request while `remoteImages` is false. Its place
 *   shows the host name. With `onAllowRemoteImages` and at least one remote
 *   image in the document, a button at the top allows them.
 * - It is a scroll region that takes the focus, and its text can be selected.
 */
export function MarkdownPreview({
  text,
  resolveImage,
  remoteImages,
  onAllowRemoteImages,
  onOpenLink,
}: MarkdownPreviewProps) {
  const region = useRef<HTMLDivElement>(null)
  // The id of a React instance has characters that a footnote id should not have.
  const prefix = `md-${useId().replace(/\W/g, '')}-`
  const remoteCount = useMemo(() => countRemoteImages(text), [text])
  const context = useMemo<PreviewState>(
    () => ({ region, prefix, remoteImages, resolveImage, onOpenLink }),
    [prefix, remoteImages, resolveImage, onOpenLink],
  )

  return (
    <PreviewContext.Provider value={context}>
      {/* The scroll area takes the focus, so that the keyboard can scroll it. */}
      <div
        ref={region}
        role="region"
        aria-label="Markdown preview"
        tabIndex={0}
        className="h-full overflow-auto bg-editor text-sm leading-relaxed text-foreground outline-none select-text focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <article className="mx-auto max-w-measure px-6 py-8 wrap-anywhere">
          {onAllowRemoteImages && !remoteImages && remoteCount > 0 && (
            <div className="mb-4 flex justify-end">
              <IconButton
                icon={ImageDown}
                label={`Load remote images (${remoteCount})`}
                onClick={() => {
                  // The button goes away, so the focus moves to the region first.
                  region.current?.focus()
                  onAllowRemoteImages()
                }}
              />
            </div>
          )}
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[markInlineLinks]}
            remarkRehypeOptions={{ clobberPrefix: prefix }}
            skipHtml
            // The preview checks each URL itself, in the elements below.
            urlTransform={(url) => url}
            components={markdownComponents}
          >
            {text}
          </Markdown>
        </article>
      </div>
    </PreviewContext.Provider>
  )
}
