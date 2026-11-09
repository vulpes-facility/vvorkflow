import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/** The screen stories to capture, by Storybook id. */
const screens = [
  'screens-workbench--app-start',
  'screens-workbench--zoomed-200',
  'screens-workbench--reflow-320',
  'screens-workbench--explorer',
  'screens-workbench--explorer-light',
  'screens-workbench--macos-dark',
  'screens-workbench--macos-light',
  'screens-workbench--windows-dark',
  'screens-workbench--linux-dark',
  'screens-workbench--first-run',
  'foundations-tokens--dark',
  'foundations-tokens--light',
]

/** The viewport of a screen that needs a size other than the default 1440 by 900. */
const viewports: Record<string, { width: number; height: number }> = {
  'screens-workbench--zoomed-200': { width: 720, height: 450 },
  'screens-workbench--reflow-320': { width: 320, height: 256 },
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

    // WCAG 2.2 Level A and AA rules, as axe-core implements them.
    const results = await new AxeBuilder({ page })
      .include('#storybook-root')
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
    // exception of the criterion, and the arrow keys also move it.
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
          `#storybook-root :is(${selector})`,
        ),
      ]
        .filter((element) => element.getClientRects().length > 0)
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
        ...document.querySelectorAll<HTMLElement>('[role="region"]'),
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
