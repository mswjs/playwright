import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  use: {
    baseURL: new URL('./index.html', import.meta.url).href,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      devtools: !process.env.CI,
    },
  },
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  reporter: 'list',
})
