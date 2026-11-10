import { Channel, invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { parseFrame, type EngineFrame } from './frame.ts'
import { protocol } from './protocol.gen.ts'

/** An event of the engine, or `connection.closed` of the app core. */
export type EngineEvent = z.infer<typeof protocol.shape.event>

/** An event on the channel, with the bytes that the web UI gives back for it. */
const eventMessage = z.object({
  bytes: z.number().int().nonnegative(),
  event: protocol.shape.event,
})

/** What the web UI does with the events and the frames of the engine. */
export interface EngineStreamHandler {
  /**
   * Takes a frame of a terminal session. The stream gives the next item
   * only after the promise settles, and then tells the app core that the
   * terminal took the bytes.
   */
  frame: (frame: EngineFrame) => Promise<void> | void
  /**
   * Notes an event. It returns before the requests that follow from the
   * event are done, so that the stream does not wait for them.
   */
  event: (event: EngineEvent) => void
}

/**
 * Opens the channel of the events and the frames of the engine
 * (`docs/architecture.md`, Protocol, rules 11 to 13). The items come in the
 * order of the connection, one after the end of the other. The stream
 * acknowledges the bytes of each item to the app core, also of an item that
 * it cannot read, so that the app core reads on.
 *
 * A page opens one stream. A second call takes the place of the first one.
 *
 * @returns A function that stops the calls of the handler; the stream still
 *   acknowledges what comes.
 */
export function openEngineStream(handler: EngineStreamHandler): () => void {
  let open = true
  let last: Promise<void> = Promise.resolve()
  const channel = new Channel<unknown>()

  async function take(message: unknown): Promise<number> {
    if (message instanceof ArrayBuffer) {
      const frame = parseFrame(message)
      if (frame && open) await handler.frame(frame)
      return message.byteLength
    }
    const parsed = eventMessage.safeParse(message)
    if (!parsed.success) return bytesOf(message)
    if (open) handler.event(parsed.data.event)
    return parsed.data.bytes
  }

  channel.onmessage = (message) => {
    last = last
      // A handler that throws does not stop the stream.
      .then(() => take(message).catch(() => bytesOf(message)))
      .then((bytes) => {
        if (bytes > 0) void invoke('acknowledge', { bytes })
      })
  }
  void invoke('subscribe', { channel })
  return () => {
    open = false
  }
}

/** The bytes to give back for a message that the stream cannot read. */
function bytesOf(message: unknown): number {
  if (message instanceof ArrayBuffer) return message.byteLength
  const bytes = (message as { bytes?: unknown } | null)?.bytes
  return typeof bytes === 'number' && bytes > 0 ? bytes : 0
}
