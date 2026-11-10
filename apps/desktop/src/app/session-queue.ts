/** A step for one session, which the engine does in the order of the steps. */
export type SessionStep =
  | { kind: 'attach' }
  | { kind: 'detach' }
  | { kind: 'write'; data: Uint8Array }
  | { kind: 'resize'; columns: number; rows: number }

/** The most input bytes of one request: its Base64 text stays far below the message limit of 1 MiB. */
export const WRITE_LIMIT = 256 * 1024

/**
 * Sends the steps of one session one after the other, so that their order
 * in the engine is the order of the user (`docs/architecture.md`, Attach,
 * output, and input, rule 7): a request of the Tauri IPC is its own task,
 * and two open requests can pass each other.
 *
 * While a request is open, the next steps wait: input bytes join into one
 * write of at most `limit` bytes, and of some resizes in a row only the last
 * one stays. A step that fails is not sent again; the next steps go on.
 *
 * @returns The function that adds a step.
 */
export function sessionQueue(
  send: (step: SessionStep) => Promise<void>,
  limit = WRITE_LIMIT,
): (step: SessionStep) => void {
  const waiting: SessionStep[] = []
  let busy = false

  async function run() {
    busy = true
    for (let step = waiting.shift(); step; step = waiting.shift())
      // A refused step, such as a write to a session that ended, is done.
      await send(step).catch(() => {})
    busy = false
  }

  return (step) => {
    const last = waiting.at(-1)
    if (
      step.kind === 'write' &&
      last?.kind === 'write' &&
      last.data.length + step.data.length <= limit
    ) {
      const data = new Uint8Array(last.data.length + step.data.length)
      data.set(last.data)
      data.set(step.data, last.data.length)
      last.data = data
    } else if (step.kind === 'resize' && last?.kind === 'resize') {
      waiting[waiting.length - 1] = step
    } else if (step.kind === 'write' && step.data.length > limit) {
      for (let start = 0; start < step.data.length; start += limit)
        waiting.push({
          kind: 'write',
          data: step.data.subarray(start, start + limit),
        })
    } else {
      waiting.push(step)
    }
    if (!busy) void run()
  }
}
