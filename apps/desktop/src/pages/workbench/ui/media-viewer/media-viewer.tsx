import { FileAudio, Maximize2, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useCallback,
  useEffect,
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
  // The source that failed to decode, so that a new source starts clean.
  const [failedSrc, setFailedSrc] = useState<string>()
  const failed = failedSrc === src
  const fail = useCallback(() => setFailedSrc(src), [src])

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-editor px-4">
        <ErrorMark
          label="File error"
          message={`${name} cannot be decoded.`}
          side="bottom"
        />
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {name}
        </span>
      </div>
    )
  }
  if (kind === 'image')
    return (
      <ImageViewer
        key={src}
        src={src}
        name={name}
        active={active}
        onError={fail}
      />
    )
  return (
    <PlayerViewer
      key={src}
      kind={kind}
      src={src}
      name={name}
      active={active}
      onError={fail}
    />
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
  const [view, setView] = useState({ width: 0, height: 0 })
  const area = useRef<HTMLDivElement>(null)
  // The point of the image in the middle of the view, to keep it there.
  const anchor = useRef<{ x: number; y: number }>(undefined)

  useEffect(() => {
    const element = area.current
    if (!element) return
    const observer = new ResizeObserver(() =>
      setView({ width: element.clientWidth, height: element.clientHeight }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The padding of the area is 16 px on each side.
  const scale =
    zoom.kind === 'scale'
      ? zoom.scale
      : natural
        ? fitScale(natural, {
            width: view.width - 32,
            height: view.height - 32,
          })
        : 1

  function zoomTo(next: Zoom) {
    const element = area.current
    if (element && element.scrollWidth > 0 && element.scrollHeight > 0)
      anchor.current = {
        x: (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth,
        y:
          (element.scrollTop + element.clientHeight / 2) / element.scrollHeight,
      }
    setZoom(next)
  }

  // After a zoom, the same point of the image is in the middle of the view.
  useLayoutEffect(() => {
    const element = area.current
    const point = anchor.current
    anchor.current = undefined
    if (!element || !point) return
    element.scrollLeft = point.x * element.scrollWidth - element.clientWidth / 2
    element.scrollTop =
      point.y * element.scrollHeight - element.clientHeight / 2
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
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="flex min-h-full w-fit min-w-full p-4">
          <img
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
    // Only an active element reports an error: removing the source is not one.
    media.addEventListener('error', onError)
    media.src = src
    if (saved?.src === src && saved.time > 0)
      media.addEventListener(
        'loadedmetadata',
        () => {
          media.currentTime = saved.time
        },
        { once: true },
      )
    return () => {
      media.removeEventListener('error', onError)
      position.current = { src, time: media.currentTime }
      media.pause()
      // Without a source and a load, the element keeps its decoder.
      media.removeAttribute('src')
      media.load()
    }
  }, [active, src, onError])

  const common = {
    ref: element,
    controls: true,
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
