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
import type { TerminalSession } from '../../model/terminal'
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
}

/**
 * The terminal of a session: an xterm.js terminal with the DOM renderer, in
 * the colors of the design tokens.
 */
export function TerminalView({ session, platform }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const hint = useId()

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

    const input = terminal.onData((data) => session.write?.(data))
    const size = terminal.onResize(({ cols, rows }) =>
      session.resize?.(cols, rows),
    )

    // Take the output from the start, and keep it until the terminal opens.
    let opened = false
    const pending: string[] = []
    const unsubscribe = session.subscribe((data) => {
      if (opened) terminal.write(data)
      else pending.push(data)
    })

    // Open only with the real font and a visible host: the font sets the
    // width of the cells, and a hidden host has no size to fit.
    let fontReady = false
    let disposed = false
    function openWhenReady() {
      if (disposed || opened || !fontReady || !element) return
      if (!element.isConnected || !element.clientWidth || !element.clientHeight)
        return
      opened = true
      terminal.open(element)
      terminal.textarea?.setAttribute('aria-describedby', hint)
      fit.fit()
      for (const data of pending.splice(0)) terminal.write(data)
    }
    // A hidden tab has no size; a fit would squeeze the grid to 2 columns.
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (!width || !height) return
      if (opened) fit.fit()
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
      unsubscribe()
      scheme.disconnect()
      resize.disconnect()
      input.dispose()
      size.dispose()
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
