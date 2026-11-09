import { useEffect, useState } from 'react'
import type { WindowControls as Controls } from '@/shared/api'
import { cn } from '@/shared/lib'

interface WindowControlsProps {
  controls: Controls
  /** `windows` draws the Windows 11 caption buttons; `linux` draws round GNOME buttons. */
  variant: 'windows' | 'linux'
}

/** The minimize, maximize, and close buttons of a window without native decorations. */
export function WindowControls({ controls, variant }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => controls.watchMaximized(setMaximized), [controls])

  const buttons = [
    {
      id: 'minimize',
      label: 'Minimize',
      onClick: controls.minimize,
      glyph: <MinimizeGlyph />,
    },
    {
      id: 'maximize',
      label: maximized ? 'Restore' : 'Maximize',
      onClick: controls.toggleMaximize,
      glyph: maximized ? <RestoreGlyph /> : <MaximizeGlyph />,
    },
    {
      id: 'close',
      label: 'Close',
      onClick: controls.close,
      glyph: <CloseGlyph />,
      close: true,
    },
  ]

  return (
    <div
      role="group"
      aria-label="Window"
      className={cn(
        'flex h-full items-center',
        variant === 'linux' && 'gap-2 pr-2.5 pl-1',
      )}
    >
      {buttons.map((button) => (
        <button
          key={button.id}
          type="button"
          aria-label={button.label}
          title={button.label}
          onClick={button.onClick}
          className={cn(
            'flex items-center justify-center text-chrome-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
            variant === 'windows' && [
              'h-full w-caption-button',
              button.close
                ? 'hover:bg-window-close-hover hover:text-window-close-hover-foreground'
                : 'hover:bg-hover hover:text-foreground',
            ],
            variant === 'linux' && [
              'size-6 rounded-full bg-hover hover:bg-selection hover:text-foreground',
            ],
          )}
        >
          {button.glyph}
        </button>
      ))}
    </div>
  )
}

const glyphProps = {
  width: 10,
  height: 10,
  viewBox: '0 0 10 10',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  'aria-hidden': true,
} as const

function MinimizeGlyph() {
  return (
    <svg {...glyphProps}>
      <path d="M0 5.5h10" />
    </svg>
  )
}

function MaximizeGlyph() {
  return (
    <svg {...glyphProps}>
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  )
}

function RestoreGlyph() {
  return (
    <svg {...glyphProps}>
      <rect x="0.5" y="2.5" width="7" height="7" />
      <path d="M2.5 2.5V0.5h7v7h-2" />
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg {...glyphProps}>
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
    </svg>
  )
}
