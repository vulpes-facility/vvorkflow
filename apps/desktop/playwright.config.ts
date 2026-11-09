import { defineConfig, devices } from '@playwright/test'

/**
 * Captures the screen stories of Storybook in Chromium (WebView2, Android) and
 * WebKit (WKWebView, WebKitGTK), and checks each one against WCAG 2.2 AA.
 * Run it with `pnpm screens`, which builds Storybook first.
 *
 * https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:6007',
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
    command:
      'pnpm exec vite preview --outDir storybook-static --port 6007 --strictPort',
    url: 'http://localhost:6007',
    reuseExistingServer: !process.env.CI,
  },
})
