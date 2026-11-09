import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useId, useRef } from 'react'
import { readColorToken, readPixelToken, type Platform } from '@/shared/lib'
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
    const fontFamily = getComputedStyle(element).fontFamily
    const fontSize = readPixelToken('--vv-terminal-font-size', 13)
    const terminal = new Terminal({
      fontFamily,
      fontSize,
      lineHeight: 1.2,
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
    // A hidden tab has no size; a fit would squeeze the grid to 2 columns.
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (terminal.element && width > 0 && height > 0) fit.fit()
    })

    let disposed = false
    let unsubscribe = () => {}
    // Measure the cells only with the real font, or the grid has the wrong width.
    void document.fonts
      .load(`${fontSize}px ${fontFamily}`)
      .catch(() => [])
      .then(() => {
        if (disposed) return
        terminal.open(element)
        terminal.textarea?.setAttribute('aria-describedby', hint)
        fit.fit()
        resize.observe(element)
        unsubscribe = session.subscribe((data) => terminal.write(data))
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
