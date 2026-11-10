import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import {
  DEFAULT_TERMINAL_SIZE,
  type TerminalSession,
  type TerminalSink,
} from '@/pages/workbench'
import {
  attachSession,
  createSession,
  detachSession,
  killSession,
  listSessions,
  openEngineStream,
  resizeSession,
  writeSession,
  type EngineEvent,
  type EngineFrame,
  type Session,
} from '@/shared/api'
import { sessionQueue, type SessionStep } from './session-queue'

const sessionsKey = ['engine', 'sessions']

/**
 * The terminals of this page: for each session, the terminal that shows it
 * now, and the queue that keeps the order of its requests. The engine and
 * the stream are one for the page, so this is one object, too.
 */
const hub = {
  sinks: new Map<string, TerminalSink>(),
  queues: new Map<string, (step: SessionStep) => void>(),
  terminals: new Map<string, TerminalSession>(),
  /** The sessions that got a detach because a frame came for no terminal. */
  strays: new Set<string>(),
  onEnded: (_session: string) => {},
  onClosed: () => {},

  step(session: string, step: SessionStep) {
    let queue = hub.queues.get(session)
    if (!queue) {
      queue = sessionQueue((next) => send(session, next))
      hub.queues.set(session, queue)
    }
    queue(step)
  },

  /** Gives a frame to the terminal of its session. */
  frame(frame: EngineFrame): Promise<void> | void {
    const sink = hub.sinks.get(frame.session)
    if (sink)
      return frame.kind === 'screen'
        ? sink.screen(frame)
        : sink.output(frame.data)
    // A frame for no terminal: a page before this one attached the session,
    // or the frame was on its way when the terminal went away. One detach
    // stops the output.
    if (hub.strays.has(frame.session)) return
    hub.strays.add(frame.session)
    hub.step(frame.session, { kind: 'detach' })
  },

  event({ event, params }: EngineEvent) {
    if (event === 'session.resized')
      hub.sinks.get(params.session)?.resized(params.columns, params.rows)
    else if (event === 'session.ended') hub.forget(params.session)
    else if (event === 'connection.closed') {
      // The attachments of that connection are gone: attach again. A session
      // that is gone with its engine refuses, and the new list has no tab
      // for it.
      for (const session of hub.sinks.keys())
        hub.step(session, { kind: 'attach' })
      hub.onClosed()
    }
  },

  forget(session: string) {
    hub.queues.delete(session)
    hub.terminals.delete(session)
    hub.strays.delete(session)
    hub.onEnded(session)
  },

  /** The terminal session of the workbench for a session of the engine: one object for each id. */
  terminal({ id, title, folder }: Session): TerminalSession {
    let terminal = hub.terminals.get(id)
    if (!terminal) {
      terminal = {
        id,
        title,
        folder,
        attach(sink) {
          hub.sinks.set(id, sink)
          hub.strays.delete(id)
          hub.step(id, { kind: 'attach' })
          return () => {
            // A newer terminal of the same session keeps its place.
            if (hub.sinks.get(id) !== sink) return
            hub.sinks.delete(id)
            hub.step(id, { kind: 'detach' })
          }
        },
        write: (data) => hub.step(id, { kind: 'write', data }),
        resize: (columns, rows) =>
          hub.step(id, { kind: 'resize', columns, rows }),
      }
      hub.terminals.set(id, terminal)
    }
    return terminal
  },
}

async function send(session: string, step: SessionStep): Promise<void> {
  if (step.kind === 'attach') await attachSession(session)
  else if (step.kind === 'detach') await detachSession(session)
  else if (step.kind === 'write') await writeSession(session, step.data)
  else await resizeSession(session, step.columns, step.rows)
}

/**
 * The terminal sessions of the engine, as the workbench shows them.
 *
 * @param ready True when the engine answered `hello`. Before that, there are
 *   no sessions and no actions.
 * @param worktree The open worktree where a new terminal starts; without it,
 *   the projects root.
 * @returns The sessions in the order of their start, the action that starts
 *   a session, and the action that ends one. A session that ends, here or
 *   in the engine, leaves the list.
 */
export function useEngineTerminals(
  ready: boolean,
  worktree?: string,
): {
  terminals: TerminalSession[]
  newTerminal?: () => void
  killTerminal?: (id: string) => void
} {
  const queryClient = useQueryClient()
  const listed = useQuery({
    queryKey: sessionsKey,
    queryFn: listSessions,
    enabled: ready,
  })

  useEffect(() => {
    if (!ready) return
    hub.onEnded = (session) =>
      queryClient.setQueryData<Session[]>(sessionsKey, (sessions) =>
        sessions?.filter(({ id }) => id !== session),
      )
    hub.onClosed = () =>
      void queryClient.invalidateQueries({ queryKey: sessionsKey })
    return openEngineStream({ frame: hub.frame, event: hub.event })
  }, [ready, queryClient])

  const terminals = useMemo(
    () => (listed.data ?? []).map(hub.terminal),
    [listed.data],
  )
  if (!ready) return { terminals: [] }
  return {
    terminals,
    newTerminal: () => {
      const { columns, rows } = DEFAULT_TERMINAL_SIZE
      void createSession(columns, rows, worktree)
        .then((session) =>
          queryClient.setQueryData<Session[]>(sessionsKey, (sessions) => [
            ...(sessions ?? []).filter(({ id }) => id !== session.id),
            session,
          ]),
        )
        // A refusal, such as the limit of sessions, shows in the list as it is.
        .catch(() => queryClient.invalidateQueries({ queryKey: sessionsKey }))
    },
    killTerminal: (id) => {
      // Only an attached client gets the event of the end, so read the list.
      void killSession(id)
        .catch(() => {})
        .then(() => queryClient.invalidateQueries({ queryKey: sessionsKey }))
    },
  }
}
