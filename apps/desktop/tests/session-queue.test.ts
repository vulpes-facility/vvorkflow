import { describe, expect, it } from 'vitest'
import { sessionQueue, type SessionStep } from '../src/app/session-queue.ts'

/** A send that the test ends by hand, to hold a request open. */
function slowSend() {
  const sent: SessionStep[] = []
  const open: { resolve: () => void; reject: (error: Error) => void }[] = []
  const send = (step: SessionStep) =>
    new Promise<void>((resolve, reject) => {
      sent.push(step)
      open.push({ resolve, reject })
    })
  /** Ends the oldest open request, and lets the queue go on. */
  async function end(error?: Error) {
    const request = open.shift()
    if (!request) throw new Error('no request is open')
    if (error) request.reject(error)
    else request.resolve()
    await new Promise((resolve) => setTimeout(resolve))
  }
  return { send, sent, open, end }
}

const text = (step: SessionStep | undefined) =>
  step?.kind === 'write' ? new TextDecoder().decode(step.data) : step?.kind
const write = (data: string): SessionStep => ({
  kind: 'write',
  data: new TextEncoder().encode(data),
})

describe('the queue of a session', () => {
  it('sends one step at a time, in the order of the user', async () => {
    const { send, sent, open, end } = slowSend()
    const add = sessionQueue(send)
    add({ kind: 'attach' })
    add(write('a'))
    add({ kind: 'detach' })
    add({ kind: 'attach' })
    // The first request is open; no other one passes it.
    expect(sent.map(text)).toEqual(['attach'])
    expect(open).toHaveLength(1)
    await end()
    await end()
    await end()
    await end()
    expect(sent.map(text)).toEqual(['attach', 'a', 'detach', 'attach'])
  })

  it('joins the input that waits into one write, in its order', async () => {
    const { send, sent, end } = slowSend()
    const add = sessionQueue(send)
    add(write('l'))
    add(write('s'))
    add(write(' -la'))
    add(write('\r'))
    await end()
    await end()
    expect(sent.map(text)).toEqual(['l', 's -la\r'])
  })

  it('keeps a resize between the writes that came before and after it', async () => {
    const { send, sent, end } = slowSend()
    const add = sessionQueue(send)
    add(write('a'))
    add(write('b'))
    add({ kind: 'resize', columns: 100, rows: 30 })
    add({ kind: 'resize', columns: 120, rows: 40 })
    add(write('c'))
    add(write('d'))
    for (let step = 0; step < 4; step++) await end()
    // Of the two resizes in a row, only the last one goes out.
    expect(sent).toHaveLength(4)
    expect(sent.map(text)).toEqual(['a', 'b', 'resize', 'cd'])
    expect(sent[2]).toEqual({ kind: 'resize', columns: 120, rows: 40 })
  })

  it('cuts input at the limit of one request, with no byte lost', async () => {
    const { send, sent, end } = slowSend()
    const add = sessionQueue(send, 4)
    add(write('x'))
    add(write('abcdefghij'))
    add(write('k'))
    add(write('lmn'))
    add(write('o'))
    for (let step = 0; step < 5; step++) await end()
    // The input that waits fills each request up to the limit.
    expect(sent.map(text)).toEqual(['x', 'abcd', 'efgh', 'ijk', 'lmno'])
  })

  it('does not send a refused step again, and goes on with the next', async () => {
    const { send, sent, end } = slowSend()
    const add = sessionQueue(send)
    add(write('a'))
    add({ kind: 'resize', columns: 80, rows: 24 })
    await end(new Error('The input queue of the session is full.'))
    await end()
    add(write('b'))
    await end()
    expect(sent.map(text)).toEqual(['a', 'resize', 'b'])
  })
})
