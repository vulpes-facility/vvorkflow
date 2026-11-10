import { FileAudio, Maximize2, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { ErrorMark, IconButton } from '@/shared/ui'
import {
  fitScale,
  stepScale,
  zoomKeyAction,
  type Zoom,
} from '../../model/image-zoom'

/** The props of the media viewer. */
export interface MediaViewerProps {
  kind: 'image' | 'video' | 'audio'
  /** The URL of the media. */
  src: string
  /** The name of the file, for the accessible name. */
  name: string
  /**
   * False for a hidden tab: playback stops, and the element drops its decoded
   * data. True again continues at the same position, paused.
   */
  active: boolean
}

/**
 * The viewer of an image, a video, or an audio file, as a tab of the editor
 * area.
 *
 * - Image: fits the view. Actual size, zoom in, zoom out, and reset are
 *   buttons, and the keys `+`, `-`, and `0` while the viewer has the focus.
 *   The pixel size shows next to the buttons. A transparent image shows on a
 *   checkerboard.
 * - Video and audio: the native element with its controls. It does not play
 *   by itself, and it loads only the metadata.
 * - `active` false: the element stops, remembers its position, and gives up
 *   its source. `active` true: it takes the source and the position back,
 *   paused.
 * - A file that does not decode shows a warning icon with the message in its
 *   tooltip, and no broken image.
 */
export function MediaViewer({ kind, src, name, active }: MediaViewerProps) {
  // The kind and the source that failed to decode. A new kind or a new source
  // starts clean: the same file can decode as another kind.
  const identity = `${kind}:${src}`
  const [failedIdentity, setFailedIdentity] = useState<string>()
  const failed = failedIdentity === identity
  const viewerId = useId()
  const root = useRef<HTMLDivElement>(null)

  // A new kind, a new source, or a decode error replaces the content of the
  // viewer, and the control that had the focus goes away with it. The label of
  // that control is kept ('' for a control without a label, such as the scroll
  // area), so that the new content can give the focus back (WCAG 2.2 SC
  // 2.4.3). A viewer that did not have the focus does not take it.
  const [seen, setSeen] = useState(identity)
  const [refocus, setRefocus] = useState<string>()
  const focusedLabel = () => {
    const active = document.activeElement
    return active?.closest(`[data-viewer="${viewerId}"]`)
      ? (active.getAttribute('aria-label') ?? '')
      : undefined
  }
  if (seen !== identity) {
    setSeen(identity)
    setRefocus(focusedLabel())
  }
  const fail = useCallback(() => {
    setRefocus(focusedLabel())
    setFailedIdentity(identity)
    // oxlint-disable-next-line react/exhaustive-deps
  }, [identity, viewerId])

  useLayoutEffect(() => {
    if (refocus === undefined) return
    setRefocus(undefined)
    const container = root.current
    if (!container) return
    // The same control, when the new content has it; else the focus target of
    // the content: the scroll area, the media element, or the error icon.
    const same = [...container.querySelectorAll('button')].find(
      (button) =>
        refocus !== '' && button.getAttribute('aria-label') === refocus,
    )
    ;(
      same ?? container.querySelector<HTMLElement>('[data-viewer-focus]')
    )?.focus()
  }, [refocus])

  let content: React.ReactNode
  if (failed) {
    content = (
      <div className="flex h-full items-center justify-center gap-2 bg-editor px-4">
        <ErrorMark
          data-viewer-focus
          label="File error"
          message={`${name} cannot be decoded.`}
          side="bottom"
        />
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {name}
        </span>
      </div>
    )
  } else if (kind === 'image') {
    content = (
      <ImageViewer
        key={identity}
        src={src}
        name={name}
        active={active}
        onError={fail}
      />
    )
  } else {
    content = (
      <PlayerViewer
        key={identity}
        kind={kind}
        src={src}
        name={name}
        active={active}
        onError={fail}
      />
    )
  }
  return (
    <div ref={root} data-viewer={viewerId} className="h-full min-h-0">
      {content}
    </div>
  )
}

function ImageViewer({
  src,
  name,
  active,
  onError,
}: {
  src: string
  name: string
  active: boolean
  onError: () => void
}) {
  const [zoom, setZoom] = useState<Zoom>({ kind: 'fit' })
  const [natural, setNatural] = useState<{ width: number; height: number }>()
  // The room of the image in the area: its size without the padding.
  const [view, setView] = useState({ width: 0, height: 0 })
  const area = useRef<HTMLDivElement>(null)
  // The point of the image in the middle of the view, to keep it there.
  const anchor = useRef<{ x: number; y: number }>(undefined)
  const image = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const element = area.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      // The padding of the content is a class, so measure it.
      const style = getComputedStyle(element.firstElementChild ?? element)
      const sum = (a: string, b: string) =>
        (Number.parseFloat(a) || 0) + (Number.parseFloat(b) || 0)
      setView({
        width: element.clientWidth - sum(style.paddingLeft, style.paddingRight),
        height:
          element.clientHeight - sum(style.paddingTop, style.paddingBottom),
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const scale =
    zoom.kind === 'scale' ? zoom.scale : natural ? fitScale(natural, view) : 1

  function zoomTo(next: Zoom) {
    // The point of the image in the middle of the view, as fractions of the
    // image itself: the padding and the margins are not part of it.
    const bounds = image.current?.getBoundingClientRect()
    const center = viewCenter()
    if (bounds && center && bounds.width > 0 && bounds.height > 0)
      anchor.current = {
        x: clamp((center.x - bounds.left) / bounds.width),
        y: clamp((center.y - bounds.top) / bounds.height),
      }
    setZoom(next)
  }

  /** The middle of the view, in the coordinates of the window. */
  function viewCenter() {
    const element = area.current
    if (!element) return undefined
    const box = element.getBoundingClientRect()
    return {
      x: box.left + element.clientLeft + element.clientWidth / 2,
      y: box.top + element.clientTop + element.clientHeight / 2,
    }
  }

  // After a zoom, the same point of the image is in the middle of the view.
  useLayoutEffect(() => {
    const element = area.current
    const bounds = image.current?.getBoundingClientRect()
    const center = viewCenter()
    const point = anchor.current
    anchor.current = undefined
    if (!element || !bounds || !center || !point) return
    element.scrollLeft += bounds.left + point.x * bounds.width - center.x
    element.scrollTop += bounds.top + point.y * bounds.height - center.y
  }, [scale])

  const actual = zoom.kind === 'scale' && zoom.scale === 1
  const act = (action: 'in' | 'out' | 'reset' | 'actual') => {
    if (action === 'reset') zoomTo({ kind: 'fit' })
    else if (action === 'actual')
      zoomTo(actual ? { kind: 'fit' } : { kind: 'scale', scale: 1 })
    else zoomTo({ kind: 'scale', scale: stepScale(scale, action) })
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const action = zoomKeyAction(event)
    if (!action) return
    event.preventDefault()
    act(action)
  }

  return (
    <div
      onKeyDown={onKeyDown}
      className="flex h-full min-h-0 flex-col bg-editor"
    >
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-hairline px-2">
        <IconButton
          icon={Maximize2}
          label="Actual size"
          pressed={actual}
          onClick={() => act('actual')}
        />
        <IconButton
          icon={ZoomOut}
          label="Zoom out"
          keys="-"
          onClick={() => act('out')}
        />
        <IconButton
          icon={ZoomIn}
          label="Zoom in"
          keys="+"
          onClick={() => act('in')}
        />
        <IconButton
          icon={Scan}
          label="Fit to view"
          keys="0"
          onClick={() => act('reset')}
        />
        {natural && (
          <p className="ml-auto flex min-w-0 items-center gap-2 pl-2 font-mono text-xs text-muted-foreground tabular-nums">
            <span className="truncate">
              {natural.width} × {natural.height}
            </span>
            <span>{Math.round(scale * 100)}%</span>
          </p>
        )}
      </div>
      {/* The scroll area takes the focus, so that the arrow keys scroll a large image. */}
      <div
        ref={area}
        role="group"
        aria-label={name}
        tabIndex={0}
        data-viewer-focus
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="flex min-h-full w-fit min-w-full p-4">
          <img
            ref={image}
            // An inactive tab gives up the source and its decoded data.
            src={active ? src : undefined}
            alt={name}
            decoding="async"
            draggable={false}
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => active && onError()}
            style={
              natural
                ? {
                    width: Math.max(1, Math.floor(natural.width * scale)),
                    height: Math.max(1, Math.floor(natural.height * scale)),
                    imageRendering: scale >= 2 ? 'pixelated' : undefined,
                  }
                : undefined
            }
            className={`m-auto max-w-none checkerboard ${natural ? '' : 'invisible'}`}
          />
        </div>
      </div>
    </div>
  )
}

function PlayerViewer({
  kind,
  src,
  name,
  active,
  onError,
}: {
  kind: 'video' | 'audio'
  src: string
  name: string
  active: boolean
  onError: () => void
}) {
  const element = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  // The position of the source that the element had when it went inactive.
  const position = useRef<{ src: string; time: number }>(undefined)

  useEffect(() => {
    const media = element.current
    if (!media || !active) return
    const saved = position.current
    // The position comes back when the metadata is there. Until then, the
    // saved position stays, also when the tab goes inactive again.
    let pending = saved?.src === src && saved.time > 0
    const restore = () => {
      pending = false
      if (saved) media.currentTime = saved.time
    }
    if (pending) media.addEventListener('loadedmetadata', restore)
    // Only an active element reports an error: removing the source is not one.
    media.addEventListener('error', onError)
    media.src = src
    return () => {
      media.removeEventListener('loadedmetadata', restore)
      media.removeEventListener('error', onError)
      if (!pending) position.current = { src, time: media.currentTime }
      media.pause()
      // Without a source and a load, the element keeps its decoder.
      media.removeAttribute('src')
      media.load()
    }
  }, [active, src, onError])

  const common = {
    ref: element,
    controls: true,
    tabIndex: 0,
    'data-viewer-focus': true,
    preload: 'metadata',
    'aria-label': name,
  } as const

  if (kind === 'video')
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-editor p-4">
        <video
          {...common}
          playsInline
          className="max-h-full max-w-full rounded-md bg-muted outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
    )
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-editor p-4">
      <p className="flex max-w-full items-center gap-2 font-mono text-xs text-muted-foreground">
        <FileAudio
          className="size-icon shrink-0 text-subtle-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 truncate">{name}</span>
      </p>
      <audio
        {...common}
        className="w-full max-w-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  )
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}
