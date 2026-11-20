import { defineConfig } from '@playwright/test'

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

export default defineConfig({
  testDir: './qa/design',
  outputDir: './artifacts/design/screens',
  reporter: [['list'], ['json', { outputFile: './artifacts/design/results.json' }]],
  forbidOnly: true,
  workers: 2,
  use: {
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'Asia/Bangkok',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 } },
    { name: 'laptop', use: { viewport: { width: 980, height: 880 }, deviceScaleFactor: 1 } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'compact', use: { viewport: { width: 320, height: 760 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
      reducedMotion: 'reduce' } },
  ],
})
