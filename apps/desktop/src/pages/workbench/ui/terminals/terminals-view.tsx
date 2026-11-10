import { SquareTerminal } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/shared/ui'

/** A session in the list: its id, its title now, and its folder. */
export interface TerminalsViewItem {
  id: string
  title: string
  /** The folder where the shell started; the list shows its name. */
  folder?: string
}

interface TerminalsViewProps {
  sessions: TerminalsViewItem[]
  /** Shows the tab of a session, and makes one when it has none. */
  onOpen: (id: string) => void
  /** Ends a session. Without it, a row has no menu. */
  onKill?: (id: string) => void
}

/** The last name of a path, with `/` or `\` between its names. */
function nameOf(folder: string) {
  return folder.split(/[/\\]/).findLast(Boolean) ?? folder
}

/**
 * The list of the terminal sessions of the engine, also of those that have
 * no tab: a session continues when its tab closes. The list has one tab
 * stop; the arrow keys, Home, and End move in it, and Enter shows the tab of
 * a session. The menu of a row ends its session. When a session ends while
 * its row has the focus, the focus moves to the row in its place, or to the
 * last row (WCAG 2.2 SC 2.4.3).
 */
export function TerminalsView({
  sessions,
  onOpen,
  onKill,
}: TerminalsViewProps) {
  const list = useRef<HTMLUListElement>(null)
  const [focused, setFocused] = useState<string>()
  // The tab stop is the row that had the focus last, or the first row.
  const stop = sessions.some(({ id }) => id === focused)
    ? focused
    : sessions[0]?.id

  // The row that has the focus, or whose menu is open, and the rows that
  // the last update showed.
  const held = useRef<string | null>(null)
  const shown = useRef<string[]>([])
  useLayoutEffect(() => {
    const before = shown.current
    shown.current = sessions.map(({ id }) => id)
    const id = held.current
    if (id === null || shown.current.includes(id)) return
    held.current = null
    // Only a focus that the update took away moves.
    if (document.activeElement !== document.body) return
    const rows = list.current?.querySelectorAll<HTMLElement>('[data-session]')
    rows?.[Math.min(before.indexOf(id), rows.length - 1)]?.focus()
  }, [sessions])

  function move(event: React.KeyboardEvent, index: number) {
    const last = sessions.length - 1
    const next = {
      ArrowDown: Math.min(index + 1, last),
      ArrowUp: Math.max(index - 1, 0),
      Home: 0,
      End: last,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    list.current?.querySelectorAll<HTMLElement>('[data-session]')[next]?.focus()
  }

  return (
    <ul ref={list} aria-label="Terminals" className="flex flex-col py-1">
      {sessions.map((session, index) => {
        const row: React.ComponentProps<'button'> & { 'data-session': string } =
          {
            type: 'button',
            'data-session': session.id,
            tabIndex: session.id === stop ? 0 : -1,
            onFocus: () => {
              held.current = session.id
              setFocused(session.id)
            },
            // The focus that goes to the menu of the row stays with the row.
            onBlur: (event) => {
              const next = event.relatedTarget
              if (next instanceof Element && !next.closest('[role="menu"]'))
                held.current = null
            },
            onClick: () => onOpen(session.id),
            onKeyDown: (event) => {
              // WebKit sends no `contextmenu` event for these keys.
              if (
                onKill &&
                (event.key === 'ContextMenu' ||
                  (event.shiftKey && event.key === 'F10'))
              ) {
                event.preventDefault()
                const { left, bottom } =
                  event.currentTarget.getBoundingClientRect()
                event.currentTarget.dispatchEvent(
                  new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: left + 8,
                    clientY: bottom,
                  }),
                )
                return
              }
              move(event, index)
            },
            className:
              'flex h-row w-full min-w-0 items-center gap-2 px-4 text-left text-ui text-sidebar-foreground outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
          }
        const content = (
          <>
            <SquareTerminal
              aria-hidden
              strokeWidth={1.75}
              className="size-icon-sm shrink-0 text-subtle-foreground"
            />
            <span className="min-w-0 truncate">{session.title}</span>
            {session.folder && (
              <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                {nameOf(session.folder)}
              </span>
            )}
          </>
        )
        return (
          <li key={session.id}>
            {onKill ? (
              <ContextMenu>
                <ContextMenuTrigger render={<button {...row} />}>
                  {content}
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => onKill(session.id)}>
                    Kill terminal
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ) : (
              <button {...row}>{content}</button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
