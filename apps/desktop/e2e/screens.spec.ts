import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/** The screen stories to capture, by Storybook id. */
const screens = [
  'screens-workbench--app-start',
  'screens-workbench--zoomed-200',
  'screens-workbench--reflow-320',
  'screens-workbench--explorer',
  'screens-workbench--explorer-light',
  'screens-workbench--terminal',
  'screens-workbench--terminal-light',
  'screens-workbench--macos-dark',
  'screens-workbench--macos-light',
  'screens-workbench--windows-dark',
  'screens-workbench--linux-dark',
  'screens-workbench--first-run',
  'screens-workbench--root-error',
  'screens-workbench--root-error-reflow-320',
  'screens-workbench--new-project',
  'screens-workbench--new-project-light',
  'screens-workbench--new-project-error',
  'screens-workbench--new-project-error-reflow-320',
  'screens-editor--type-script-dark',
  'screens-editor--type-script-light',
  'screens-editor--markdown',
  'screens-editor--search-open',
  'screens-editor--search-replace',
  'screens-editor--search-light',
  'screens-editor--search-reflow-320',
  'screens-editor--read-only',
  'screens-editor--crlf',
  'screens-editor--reflow-320',
  'screens-editor--diff-wide-dark',
  'screens-editor--diff-wide-light',
  'screens-editor--diff-narrow',
  'screens-editor--harness',
  'screens-editor--diff-harness',
  'screens-editor--strict-harness',
  'foundations-tokens--dark',
  'foundations-tokens--light',
]

/** The viewport of a screen that needs a size other than the default 1440 by 900. */
const viewports: Record<string, { width: number; height: number }> = {
  'screens-workbench--zoomed-200': { width: 720, height: 450 },
  'screens-workbench--reflow-320': { width: 320, height: 256 },
  'screens-workbench--root-error-reflow-320': { width: 320, height: 256 },
  'screens-editor--reflow-320': { width: 320, height: 256 },
  'screens-editor--search-reflow-320': { width: 320, height: 320 },
  'screens-workbench--new-project-error-reflow-320': {
    width: 320,
    height: 256,
  },
}

for (const id of screens) {
  test(id, async ({ page }, testInfo) => {
    const viewport = viewports[id]
    if (viewport) await page.setViewportSize(viewport)
    // `a11y.manual` stops the automatic run of the Storybook a11y addon, which
    // would collide with the axe-core run below ("Axe is already running").
    await page.goto(
      `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`,
    )
    await page.locator('#storybook-root > *').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    // A terminal opens after its font loads, so wait for its rows.
    if (id.startsWith('screens-workbench--terminal')) {
      await page
        .locator('.xterm-rows')
        .locator('visible=true')
        .first()
        .waitFor()
    }

    // The editor highlights a file after its language loads, and opens the
    // search panel on `mod+F`.
    if (id.startsWith('screens-editor--')) {
      await page.locator('.cm-content').first().waitFor()
      if (!id.includes('crlf'))
        await page.locator('.cm-line span[class]').first().waitFor()
      if (id.startsWith('screens-editor--search')) {
        await page.locator('.cm-content').click()
        // The editor takes its modifier from the user agent.
        const mac = await page.evaluate(() => /Mac/.test(navigator.userAgent))
        await page.keyboard.press(mac ? 'Meta+f' : 'Control+f')
        await page.keyboard.type('job')
        if (id.includes('replace') || id.includes('reflow')) {
          await page.getByRole('button', { name: 'Show replace' }).click()
          await page.getByRole('textbox', { name: 'Replace' }).fill('task')
        }
        // Turn on a toggle, to show its pressed state.
        await page.getByRole('button', { name: 'Match case' }).click()
      }
    }

    // The error screens show the message of the engine in its tooltip.
    if (id.startsWith('screens-workbench--root-error')) {
      // The tooltip opens on a keyboard focus.
      await page.getByRole('button', { name: 'Engine error' }).focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await page.locator('[data-slot="tooltip-content"]').waitFor()
    }

    // The New project screens show the dialog with a name, and the error
    // screens the message of the refusal in its tooltip.
    if (id.startsWith('screens-workbench--new-project')) {
      await page.getByRole('button', { name: 'New project…' }).click()
      await page.getByRole('textbox', { name: 'Name' }).fill('atlas-api')
      if (id.includes('error')) {
        await page.keyboard.press('Enter')
        await page.getByRole('button', { name: 'Name error' }).focus()
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Tab')
        await page.locator('[data-slot="tooltip-content"]').waitFor()
      }
      // The dialog fades in, and the Create button fades to its enabled
      // state. An animation that stops early does not end the wait.
      await page.evaluate(() =>
        Promise.allSettled(
          document.getAnimations().map((animation) => animation.finished),
        ),
      )
    }

    // WCAG 2.2 Level A and AA rules, as axe-core implements them.
    // An open tooltip or dialog is in a portal outside the root of the story.
    const results = await new AxeBuilder({ page })
      .include('#storybook-root')
      .include('[data-slot="tooltip-content"]')
      .include('[data-slot="dialog-content"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations.map(({ id: rule, nodes }) => ({
        rule,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([])

    // WCAG 2.2 SC 2.5.8: each pointer target is 24 by 24 CSS pixels or more.
    // A separator is left out: it is a 1 px line that passes by the spacing
    // exception of the criterion, and the arrow keys also move it. The input
    // of a terminal is left out too: it is invisible and takes the keys and
    // the IME, and the pointer target is the whole terminal screen.
    const smallTargets = await page.evaluate(() => {
      const selector = [
        'button',
        'a[href]',
        'input',
        'select',
        'textarea',
        '[role="tab"]',
        '[role="button"]',
        '[data-pointer-target]',
      ].join(', ')
      return [
        ...document.querySelectorAll<HTMLElement>(
          `:is(#storybook-root, [data-slot="dialog-content"]) :is(${selector})`,
        ),
      ]
        .filter(
          (element) =>
            element.getClientRects().length > 0 &&
            !element.matches('.xterm-helper-textarea'),
        )
        .map((element) => {
          const { width, height } = element.getBoundingClientRect()
          const name = element.getAttribute('aria-label') ?? element.title ?? ''
          return {
            target: `${element.tagName.toLowerCase()} ${name || element.textContent?.trim()}`,
            width,
            height,
          }
        })
        .filter(({ width, height }) => width < 24 || height < 24)
    })
    expect(smallTargets).toEqual([])

    // WCAG 2.2 SC 1.4.10: no horizontal scroll, in the page or in a scroll area.
    const overflowing = await page.evaluate(() =>
      [
        document.documentElement,
        ...document.querySelectorAll<HTMLElement>(
          '[role="region"], [data-slot="dialog-content"]',
        ),
      ]
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map(
          (element) =>
            element.getAttribute('aria-label') ?? element.tagName.toLowerCase(),
        ),
    )
    expect(overflowing).toEqual([])

    // The Explorer screens show one row in its hover state.
    if (id.startsWith('screens-workbench--explorer')) {
      await page.getByRole('treeitem', { name: /^scratch\.md/ }).hover()
    }

    // A foundation sheet is taller than the viewport, so take the full page.
    await page.screenshot({
      path: `screens/${testInfo.project.name}/${id}.png`,
      fullPage: id.startsWith('foundations-'),
    })
  })
}
