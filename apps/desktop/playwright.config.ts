import { defineConfig, devices } from '@playwright/test'

/**
 * Captures the screen stories of Storybook in Chromium (WebView2, Android) and
 * WebKit (WKWebView, WebKitGTK), and checks each one against WCAG 2.2 AA.
 * Run it with `pnpm screens`, which builds Storybook first.
 *
 * https://playwright.dev/docs/test-configuration
 */
/**
 * The port of the Storybook preview. `VVORKFLOW_SCREENS_PORT` changes it, so
 * that two worktrees can run `pnpm screens` at the same time, each with its
 * own build.
 */
const port = Number(process.env.VVORKFLOW_SCREENS_PORT ?? 6007)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('VVORKFLOW_SCREENS_PORT must be a port from 1 to 65535.')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite preview --outDir storybook-static --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
})
