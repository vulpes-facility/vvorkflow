import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useId, useRef } from 'react'
import {
  readColorToken,
  readPixelToken,
  readToken,
  type Platform,
} from '@/shared/lib'
import {
  binaryInput,
  sessionSize,
  type TerminalSession,
  type TerminalSink,
} from '../../model/terminal'
import { terminalKeyTarget } from '../../model/terminal-keys'

/** The theme of the terminal, from the color tokens of the current scheme. */
function terminalTheme(): ITheme {
  return {
    background: readColorToken('--terminal'),
    foreground: readColorToken('--terminal-foreground'),
    cursor: readColorToken('--terminal-cursor'),
    cursorAccent: readColorToken('--terminal'),
    selectionBackground: readColorToken('--terminal-selection'),
    selectionForeground: readColorToken('--terminal-selection-foreground'),
    selectionInactiveBackground: readColorToken('--terminal-selection'),
    black: readColorToken('--ansi-black'),
    red: readColorToken('--ansi-red'),
    green: readColorToken('--ansi-green'),
    yellow: readColorToken('--ansi-yellow'),
    blue: readColorToken('--ansi-blue'),
    magenta: readColorToken('--ansi-magenta'),
    cyan: readColorToken('--ansi-cyan'),
    white: readColorToken('--ansi-white'),
    brightBlack: readColorToken('--ansi-bright-black'),
    brightRed: readColorToken('--ansi-bright-red'),
    brightGreen: readColorToken('--ansi-bright-green'),
    brightYellow: readColorToken('--ansi-bright-yellow'),
    brightBlue: readColorToken('--ansi-bright-blue'),
    brightMagenta: readColorToken('--ansi-bright-magenta'),
    brightCyan: readColorToken('--ansi-bright-cyan'),
    brightWhite: readColorToken('--ansi-bright-white'),
  }
}

interface TerminalViewProps {
  session: TerminalSession
  platform: Platform
  /** Called with each title that the program sets. */
  onTitle?: (title: string) => void
}

/** The time that the terminal waits for the last change of its room before it proposes a size. */
const PROPOSE_TIME = 100

/**
 * The terminal of a session: an xterm.js terminal with the DOM renderer, in
 * the colors of the design tokens. It attaches to the session while it
 * shows, and detaches when it goes away; the session continues.
 *
 * The session owns the size: the terminal proposes the size that fits its
 * room, and takes the size that the session tells. So two terminals of one
 * session show the same lines.
 */
export function TerminalView({
  session,
  platform,
  onTitle,
}: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const hint = useId()
  // The last handler, so that a new one does not make a new terminal.
  const title = useRef(onTitle)
  useEffect(() => {
    title.current = onTitle
  }, [onTitle])

  useEffect(() => {
    const element = host.current
    if (!element) return
    // Read the font from the token: a hidden panel is detached, and a
    // detached element has no computed font.
    const fontFamily = readToken('--vv-font-mono', 'monospace')
    const fontSize = readPixelToken('--vv-terminal-font-size', 13)
    const terminal = new Terminal({
      fontFamily,
      fontSize,
      lineHeight: Number(readToken('--vv-terminal-line-height', '1.2')),
      // Raise the contrast of each color that a program picks (WCAG 2.2 SC 1.4.3).
      minimumContrastRatio: 4.5,
      // A blinking cursor is motion that does not stop (WCAG 2.2 SC 2.2.2).
      cursorBlink: false,
      scrollback: 5000,
      allowProposedApi: true,
      theme: terminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'

    // The program gets its keys, but the keyboard can always leave and the
    // workbench keeps its own shortcuts.
    terminal.attachCustomKeyEventHandler((event) => {
      const target = terminalKeyTarget(event, platform === 'macos')
      if (target === 'terminal') return true
      if (target === 'copy' && event.type === 'keydown') {
        event.preventDefault()
        const selection = terminal.getSelection()
        if (selection) void navigator.clipboard?.writeText(selection)
      }
      return false
    })

    // The scheme changes the class of the root, so follow it.
    const scheme = new MutationObserver(() => {
      terminal.options.theme = terminalTheme()
    })
    scheme.observe(document.documentElement, { attributeFilter: ['class'] })

    const encoder = new TextEncoder()
    const input = terminal.onData((data) => session.write(encoder.encode(data)))
    const binary = terminal.onBinary((data) => session.write(binaryInput(data)))
    const titled = terminal.onTitleChange((next) => title.current?.(next))

    // A write of xterm.js ends in a callback, which never comes after the
    // terminal is gone: then the promise of the sink settles with the end.
    let end: () => void = () => {}
    const ended = new Promise<void>((resolve) => {
      end = resolve
    })
    const written = (data: Uint8Array) =>
      Promise.race([
        new Promise<void>((resolve) => terminal.write(data, resolve)),
        ended,
      ])
    const sink: TerminalSink = {
      screen: ({ columns, rows, data }) => {
        terminal.resize(columns, rows)
        terminal.reset()
        return written(data)
      },
      output: written,
      resized: (columns, rows) => terminal.resize(columns, rows),
    }
    // Take the output from the start. Until the terminal opens, its buffer
    // keeps the output, within the scrollback limit.
    const detach = session.attach(sink)

    // Propose the size that fits the room, after the room stopped to change.
    let proposal: ReturnType<typeof setTimeout> | undefined
    let proposed = ''
    function propose() {
      clearTimeout(proposal)
      proposal = setTimeout(() => {
        const room = fit.proposeDimensions()
        const size = sessionSize(room?.cols, room?.rows)
        if (!size || `${size.columns}x${size.rows}` === proposed) return
        proposed = `${size.columns}x${size.rows}`
        session.resize(size.columns, size.rows)
      }, PROPOSE_TIME)
    }

    // Open only with the real font and a visible host: the font sets the
    // width of the cells, and a hidden host has no size to fit.
    let opened = false
    let fontReady = false
    let disposed = false
    function openWhenReady() {
      if (disposed || opened || !fontReady || !element) return
      if (!element.isConnected || !element.clientWidth || !element.clientHeight)
        return
      opened = true
      terminal.open(element)
      terminal.textarea?.setAttribute('aria-describedby', hint)
      propose()
    }
    // A hidden tab has no size; a proposal would squeeze the grid to 2 columns.
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (!width || !height) return
      if (opened) propose()
      else openWhenReady()
    })
    resize.observe(element)
    void document.fonts
      .load(`${fontSize}px ${fontFamily}`)
      .catch(() => [])
      .then(() => {
        fontReady = true
        openWhenReady()
      })

    return () => {
      disposed = true
      clearTimeout(proposal)
      detach()
      end()
      scheme.disconnect()
      resize.disconnect()
      input.dispose()
      binary.dispose()
      titled.dispose()
      terminal.dispose()
    }
  }, [session, platform, hint])

  return (
    <div
      data-terminal
      className="h-full min-h-0 bg-terminal py-1 pl-3 font-mono"
    >
      <div ref={host} className="h-full" />
      <p id={hint} hidden>
        The terminal takes the Tab key. Press F6 to move the focus out of the
        terminal.
      </p>
    </div>
  )
}
