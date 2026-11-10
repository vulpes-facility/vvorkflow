import { expect, it } from 'vitest'
import {
  binaryInput,
  sessionSize,
} from '../src/pages/workbench/model/terminal.ts'

it('puts a proposed size in the limits of a session', () => {
  expect(sessionSize(120, 30)).toEqual({ columns: 120, rows: 30 })
  expect(sessionSize(120.9, 30.2)).toEqual({ columns: 120, rows: 30 })
  expect(sessionSize(1, 0)).toEqual({ columns: 2, rows: 1 })
  expect(sessionSize(900, 400)).toEqual({ columns: 500, rows: 200 })
  // A terminal with no room proposes no size.
  expect(sessionSize(undefined, 30)).toBeUndefined()
  expect(sessionSize(Number.NaN, 30)).toBeUndefined()
  expect(sessionSize(80, Number.POSITIVE_INFINITY)).toBeUndefined()
})

it('takes each character of binary input as one byte', () => {
  // An old mouse report: ESC [ M, the button, and two positions above 127.
  expect(binaryInput('\u001b[M àÿ')).toEqual(
    new Uint8Array([0x1b, 0x5b, 0x4d, 0x20, 0xe0, 0xff]),
  )
  expect(binaryInput('')).toEqual(new Uint8Array())
})
