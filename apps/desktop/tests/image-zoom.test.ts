import { describe, expect, it } from 'vitest'
import {
  fitScale,
  stepScale,
  zoomKeyAction,
  ZOOM_STEPS,
} from '../src/pages/workbench/model/image-zoom.ts'

describe('fitScale', () => {
  it('shrinks a large image to the view', () => {
    expect(
      fitScale({ width: 800, height: 400 }, { width: 400, height: 400 }),
    ).toBe(0.5)
    expect(
      fitScale({ width: 400, height: 800 }, { width: 400, height: 200 }),
    ).toBe(0.25)
  })
  it('does not enlarge a small image', () => {
    expect(
      fitScale({ width: 64, height: 64 }, { width: 800, height: 600 }),
    ).toBe(1)
  })
  it('keeps the actual size for an image with no size', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 800, height: 600 })).toBe(
      1,
    )
  })
})

describe('stepScale', () => {
  it('steps to the next scale in and out', () => {
    expect(stepScale(1, 'in')).toBe(1.5)
    expect(stepScale(1, 'out')).toBe(0.75)
  })
  it('steps from a scale between two steps', () => {
    expect(stepScale(0.37, 'in')).toBe(0.5)
    expect(stepScale(0.37, 'out')).toBe(0.25)
  })
  it('stops at the ends', () => {
    expect(stepScale(ZOOM_STEPS[0], 'out')).toBe(ZOOM_STEPS[0])
    expect(stepScale(16, 'in')).toBe(16)
  })
})

describe('zoomKeyAction', () => {
  const key = (name: string, extra = {}) => ({
    key: name,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  })
  it('maps the keys', () => {
    expect(zoomKeyAction(key('+'))).toBe('in')
    expect(zoomKeyAction(key('='))).toBe('in')
    expect(zoomKeyAction(key('-'))).toBe('out')
    expect(zoomKeyAction(key('0'))).toBe('reset')
    expect(zoomKeyAction(key('a'))).toBeUndefined()
  })
  it('leaves the shortcuts of the window alone', () => {
    expect(zoomKeyAction(key('+', { ctrlKey: true }))).toBeUndefined()
    expect(zoomKeyAction(key('0', { metaKey: true }))).toBeUndefined()
  })
})
