import { ImageOff } from 'lucide-react'
import { useState } from 'react'
import { classifyImageSource } from '../../model/markdown-urls'
import { usePreview } from './preview-context'

/**
 * An image of a document. A remote image loads only when the preview allows
 * it. A local image loads from the URL that `resolveImage` gives. A source
 * with another scheme, such as `data:`, never loads. In each other case, and
 * when the image fails, the place shows a placeholder of one line with an icon
 * and the host (or the path, or the scheme) as data.
 */
export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const { remoteImages, resolveImage } = usePreview()
  // The URL that failed, so that a new URL gets a new try.
  const [failedUrl, setFailedUrl] = useState<string>()
  if (!src) return null
  const source = classifyImageSource(src)

  let url: string | undefined
  let label: string
  if (source.kind === 'remote') {
    label = source.host
    if (remoteImages) url = source.url
  } else if (source.kind === 'local') {
    label = source.path
    url = resolveImage?.(source.path)
  } else {
    label = `${source.scheme}:`
  }

  if (!url || failedUrl === url)
    return (
      <span
        role="img"
        aria-label={alt ? `${alt} (${label})` : label}
        className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-border px-2 align-middle font-mono text-xs text-muted-foreground"
      >
        <ImageOff
          className="size-icon-sm shrink-0 text-subtle-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 truncate">{label}</span>
      </span>
    )
  return (
    <img
      src={url}
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(url)}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      className="inline-block h-auto max-w-full rounded-sm align-middle"
    />
  )
}
