/** A binary frame of the engine: output of a terminal session, or its screen. */
export type EngineFrame =
  | { kind: 'output'; session: string; data: Uint8Array }
  | {
      kind: 'screen'
      session: string
      /** The size that the terminal takes before it writes the data. */
      columns: number
      rows: number
      data: Uint8Array
    }

const ID_LENGTH = 16
const OUTPUT = 0
const SCREEN = 1

/**
 * Reads a binary frame (`docs/architecture.md`, Attach, output, and input,
 * rule 3): byte 0 is the kind, bytes 1 to 16 are the session id, and a
 * screen has its columns and its rows after the id, each as a big-endian
 * number of two bytes.
 *
 * @returns The frame, with its data as a view of the buffer, or `undefined`
 *   for bytes that are not a frame: too short, a kind that is not known, or
 *   an id that is not 16 hexadecimal characters.
 */
export function parseFrame(buffer: ArrayBuffer): EngineFrame | undefined {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 1 + ID_LENGTH) return undefined
  const session = String.fromCharCode(...bytes.subarray(1, 1 + ID_LENGTH))
  if (!/^[0-9a-f]{16}$/.test(session)) return undefined
  const start = 1 + ID_LENGTH
  if (bytes[0] === OUTPUT)
    return { kind: 'output', session, data: bytes.subarray(start) }
  if (bytes[0] !== SCREEN || bytes.length < start + 4) return undefined
  const view = new DataView(buffer, start, 4)
  return {
    kind: 'screen',
    session,
    columns: view.getUint16(0),
    rows: view.getUint16(2),
    data: bytes.subarray(start + 4),
  }
}

/**
 * Writes bytes as Base64 (RFC 4648, with padding), as `session.write` takes
 * its input.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // A call with all the bytes as arguments can be too large for the engine
  // of the webview.
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}
