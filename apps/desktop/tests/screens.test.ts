import { readdirSync, readFileSync } from 'node:fs'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import {
  Terminal,
  type IBuffer,
  type IBufferCell,
  type ITerminalAddon,
} from '@xterm/headless'
import { describe, expect, it } from 'vitest'

// The measure of the screen bytes of the engine (`docs/architecture.md`,
// Screen state, rule 2): for each record of output and each position in it,
// a terminal that gets the screen bytes of that position and then the output
// after it MUST show the same as a terminal that gets all the output. The
// Rust test `crates/vvorkflow-engine/tests/screens.rs` keeps the screen bytes
// of the records current.

interface ScreenRecord {
  description: string
  columns: number
  rows: number
  output: string
  positions: number[]
  /** For a position with a known limit, the parts that do not compare. */
  limits: Record<string, string[]>
  /** The screen bytes in Base64 at each position. */
  screens: Record<string, string>
}

const folder = new URL(
  '../../../crates/vvorkflow-engine/tests/screens/',
  import.meta.url,
)
const records = readdirSync(folder)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => ({
    name,
    record: JSON.parse(
      readFileSync(new URL(name, folder), 'utf8'),
    ) as ScreenRecord,
  }))

/** A terminal as the web UI makes it: 5,000 lines of scrollback, Unicode 11. */
function terminal(columns: number, rows: number) {
  const made = new Terminal({
    cols: columns,
    rows,
    scrollback: 5000,
    allowProposedApi: true,
  })
  // The addon is the one of `terminal-view.tsx`; it uses only the API that
  // the headless terminal has too.
  made.loadAddon(new Unicode11Addon() as unknown as ITerminalAddon)
  made.unicode.activeVersion = '11'
  let title = ''
  made.onTitleChange((next) => (title = next))
  return {
    terminal: made,
    title: () => title,
    /** A reset of the terminal: the screen bytes set the title again. */
    reset() {
      made.reset()
      title = ''
    },
  }
}

function write(target: Terminal, data: Uint8Array | string) {
  return new Promise<void>((resolve) => target.write(data, resolve))
}

/** The underline of a cell, which is not in the public API. */
interface Underline {
  getUnderlineStyle(): number
  getUnderlineColor(): number
  getUnderlineColorMode(): number
}

/** The attributes of a cell that a terminal shows. */
function attributes(cell: IBufferCell): string {
  const underline = cell as unknown as Underline
  const underlined = cell.isUnderline() !== 0
  return [
    cell.getFgColorMode(),
    cell.getFgColor(),
    cell.getBgColorMode(),
    cell.getBgColor(),
    cell.isBold(),
    cell.isItalic(),
    cell.isDim(),
    cell.isUnderline(),
    cell.isBlink(),
    cell.isInverse(),
    cell.isInvisible(),
    cell.isStrikethrough(),
    cell.isOverline(),
    underlined ? underline.getUnderlineStyle() : 0,
    underlined ? underline.getUnderlineColorMode() : 0,
    underlined ? underline.getUnderlineColor() : 0,
  ].join(',')
}

/**
 * Each line of a buffer: its text, the wide characters, the attributes in
 * runs, and whether it wraps from the line before. A cell that was never
 * written and a space show the same, so both are a space.
 */
function lines(buffer: IBuffer, columns: number): string[] {
  const cell = buffer.getNullCell()
  const result: string[] = []
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y)
    if (!line) continue
    let text = ''
    const runs: [string, number][] = []
    for (let x = 0; x < columns; x++) {
      line.getCell(x, cell)
      const width = cell.getWidth()
      if (width === 0) continue
      text += (cell.getChars() || ' ') + (width === 2 ? '⟩' : '')
      const style = attributes(cell)
      const last = runs.at(-1)
      if (last && last[0] === style) last[1] += width
      else runs.push([style, width])
    }
    const styles =
      runs.length === 1 && runs[0][0] === attributes(buffer.getNullCell())
        ? ''
        : runs.map(([style, count]) => ` ${count}×${style}`).join('')
    result.push(
      `${line.isWrapped ? '+' : ' '}${JSON.stringify(text.trimEnd())}${styles}`,
    )
  }
  return result
}

/** The state of a terminal that is not in the public API. */
interface Core {
  coreService: {
    isCursorHidden: boolean
    decPrivateModes: { cursorStyle?: string; cursorBlink?: boolean }
  }
  coreMouseService: { activeEncoding: string }
  optionsService: {
    rawOptions: {
      cursorStyle: string
      cursorBlink: boolean
      convertEol: boolean
    }
  }
}

/** All that the comparison checks, as one value. */
function state(made: ReturnType<typeof terminal>, skip: string[]) {
  const { terminal: shown } = made
  const active = shown.buffer.active
  const core = (shown as unknown as { _core: Core })._core
  const options = core.optionsService.rawOptions
  const cursor = core.coreService.decPrivateModes
  return {
    cursorHidden: core.coreService.isCursorHidden,
    cursorStyle: cursor.cursorStyle ?? options.cursorStyle,
    cursorBlink: cursor.cursorBlink ?? options.cursorBlink,
    lineFeedMode: options.convertEol,
    mouseEncoding: core.coreMouseService.activeEncoding,
    active: active.type,
    normal: lines(shown.buffer.normal, shown.cols),
    alternate:
      active.type === 'alternate'
        ? lines(shown.buffer.alternate, shown.cols)
        : [],
    cursor: [active.cursorX, active.cursorY],
    modes: { ...shown.modes },
    title: skip.includes('title') ? '' : made.title(),
  }
}

/**
 * Bytes that show the hidden state: the saved cursor of each screen, the
 * scroll region, and the attributes that they keep.
 */
const probe =
  '\x1b8saved\x1b[999B\n\nscrolled\x1b[?1049lnormal\x1b8normal saved'

/**
 * Output that sets state, which the reset before a screen, or the screen
 * bytes, MUST clear: xterm.js keeps a hidden cursor, the line feed mode, and
 * the blink of mode 12 after a reset.
 */
const noise =
  '\x1b[?1049h\x1b[41;1m\x1b[?2004h\x1b[?1003h\x1b[?1006h\x1b[?25l\x1b[20h' +
  '\x1b[?12h\x1b[5 q\x1b[2;3rnoise\x1b]2;old title\x07\xe2\x94'

describe.each(records)('the screen bytes of $name', ({ record }) => {
  const output = new TextEncoder().encode(record.output)

  it.each(record.positions)('at %i', async (position) => {
    const screen = record.screens[String(position)]
    expect(screen, 'the record has screen bytes here').toBeDefined()
    const skip = record.limits[String(position)] ?? []

    const whole = terminal(record.columns, record.rows)
    await write(whole.terminal, output)

    // A terminal that showed other output, as the terminal of the web UI
    // after an overflow: it resets, and then writes the screen bytes.
    const copy = terminal(record.columns, record.rows)
    await write(copy.terminal, new TextEncoder().encode(noise))
    copy.reset()
    copy.terminal.resize(record.columns, record.rows)
    await write(copy.terminal, Buffer.from(screen, 'base64'))
    await write(copy.terminal, output.subarray(position))

    expect(state(copy, skip)).toEqual(state(whole, skip))

    await write(whole.terminal, probe)
    await write(copy.terminal, probe)
    expect(state(copy, skip)).toEqual(state(whole, skip))
  })
})
