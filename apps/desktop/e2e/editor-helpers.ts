import type { Page } from '@playwright/test'

/** The probe that `fixtures/editor-harness.tsx` puts on the page. */
export interface Probe {
  calls: string[]
  setText: (text: string, version: string) => void
  setOriginal: (text: string) => void
  setReadOnly: (readOnly: boolean) => void
  setPlatform: (platform: string) => void
  setPath: (path: string) => void
  swapCallbacks: () => void
  revert: () => void
  setMounted: (mounted: boolean) => void
}
type ProbeWindow = { editorProbe?: Probe }

/** The URL of an editor story. */
export const story = (id: string, args = '') =>
  `/iframe.html?id=screens-editor--${id}&viewMode=story&globals=a11y.manual:!true${args}`

/** The content of the editor. In a wide diff, it is the editable one at the right. */
export const content = (page: Page) => page.locator('.cm-content').last()

/** Opens a story and waits for the editor and its highlight. */
export async function open(page: Page, id: string, args = '') {
  await page.goto(story(id, args))
  await content(page).waitFor()
  await page.locator('.cm-line span[class]').first().waitFor()
}

/**
 * The modifier of the shortcuts. The editor reads its platform from the
 * prop, and the story gives the prop from the user agent, so this reads the
 * user agent too. The Safari user agent of WebKit says macOS also on Linux.
 */
export const mod = (page: Page) =>
  page.evaluate(() => (/Mac/.test(navigator.userAgent) ? 'Meta' : 'Control'))

/**
 * The key that redoes. CodeMirror binds `mod+Y`, and `mod+Shift+Z` on macOS;
 * `Ctrl+Shift+Z` is bound only on Linux, and the user agent of the test
 * browsers says Windows or macOS.
 */
export const redoKey = (page: Page) =>
  page.evaluate(() =>
    /Mac/.test(navigator.userAgent) ? 'Meta+Shift+z' : 'Control+y',
  )

/** The calls of the callbacks, in order. */
export const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as ProbeWindow).editorProbe?.calls ?? [],
  )

/** Runs a function of the probe in the page. */
export const probe = <K extends keyof Probe>(
  page: Page,
  method: K,
  ...args: Probe[K] extends (...a: infer A) => unknown ? A : never
) =>
  page.evaluate(
    ([name, values]) =>
      (
        (window as unknown as ProbeWindow).editorProbe as unknown as Record<
          string,
          (...a: unknown[]) => void
        >
      )[name as string](...(values as unknown[])),
    [method, args] as const,
  )

/** Gives the editor a new text from the disk. */
export const setText = (page: Page, text: string, version: string) =>
  probe(page, 'setText', text, version)

/** The text of the last `save:` call, or undefined. */
export async function lastSave(page: Page) {
  const saves = (await calls(page)).filter((call) => call.startsWith('save:'))
  return saves.at(-1)?.slice('save:'.length)
}

/** Presses mod+S and gives the text that the editor saved. */
export async function save(page: Page) {
  const focused = await content(page).evaluate(
    (element) => element === document.activeElement,
  )
  if (!focused) await content(page).focus()
  const before = (await calls(page)).filter((c) => c.startsWith('save:')).length
  await page.keyboard.press(`${await mod(page)}+s`)
  await page.waitForFunction(
    (count) =>
      ((window as unknown as ProbeWindow).editorProbe?.calls ?? []).filter(
        (call) => call.startsWith('save:'),
      ).length > count,
    before,
  )
  return lastSave(page)
}
