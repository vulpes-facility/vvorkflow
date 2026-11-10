import { describe, expect, it } from 'vitest'
import { parseFrame, toBase64 } from '../src/shared/api/frame.ts'

const id = '5f0c2a9e41b7d386'
const bytes = (...parts: (number | string)[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'number'
        ? [part]
        : [...part].map((character) => character.charCodeAt(0)),
    ),
  ).buffer

describe('a binary frame of the engine', () => {
  it('reads an output frame: the kind, the id, and the data', () => {
    expect(parseFrame(bytes(0, id, 'ls\r\n'))).toEqual({
      kind: 'output',
      session: id,
      data: new Uint8Array([108, 115, 13, 10]),
    })
    // An output frame can have no data.
    expect(parseFrame(bytes(0, id))).toMatchObject({
      kind: 'output',
      data: new Uint8Array(),
    })
  })

  it('reads a screen frame with its size as two big-endian numbers', () => {
    expect(parseFrame(bytes(1, id, 0x01, 0xf4, 0x00, 0xc8, 'x'))).toEqual({
      kind: 'screen',
      session: id,
      columns: 500,
      rows: 200,
      data: new Uint8Array([120]),
    })
  })

  it('refuses bytes that are not a frame', () => {
    expect(parseFrame(bytes())).toBeUndefined()
    expect(parseFrame(bytes(0, id.slice(1)))).toBeUndefined()
    // A kind that the client does not know.
    expect(parseFrame(bytes(2, id, 'x'))).toBeUndefined()
    // A screen with no size.
    expect(parseFrame(bytes(1, id, 0x00, 0x50))).toBeUndefined()
    // An id that is not lowercase hexadecimal.
    expect(parseFrame(bytes(0, '5F0C2A9E41B7D386'))).toBeUndefined()
    expect(parseFrame(bytes(0, 'zzzzzzzzzzzzzzzz'))).toBeUndefined()
  })
})

describe('the input of a session', () => {
  it('is Base64 with padding, also for bytes that are not text', () => {
    expect(toBase64(new Uint8Array())).toBe('')
    expect(toBase64(new TextEncoder().encode('ls\r'))).toBe('bHMN')
    expect(toBase64(new Uint8Array([0xff]))).toBe('/w==')
    expect(toBase64(new Uint8Array([0x1b, 0x5b, 0x4d, 0xe0, 0xff]))).toBe(
      'G1tN4P8=',
    )
  })

  it('takes more bytes than one call can have as arguments', () => {
    const large = new Uint8Array(200_000).fill(65)
    const text = toBase64(large)
    expect(text.length).toBe(Math.ceil(200_000 / 3) * 4)
    expect(atob(text)).toBe('A'.repeat(200_000))
  })
})
