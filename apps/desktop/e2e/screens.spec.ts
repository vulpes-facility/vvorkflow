import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/** The screen stories to capture, by Storybook id. */
const screens = [
  'screens-workbench--macos-dark',
  'screens-workbench--macos-light',
  'screens-workbench--windows-dark',
  'screens-workbench--linux-dark',
  'screens-workbench--first-run',
  'foundations-tokens--dark',
  'foundations-tokens--light',
]

for (const id of screens) {
  test(id, async ({ page }, testInfo) => {
    await page.goto(`/iframe.html?id=${id}&viewMode=story`)
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

    await page.screenshot({
      path: `screens/${testInfo.project.name}/${id}.png`,
    })
  })
}
