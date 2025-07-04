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
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      devtools: !process.env.CI,
    },
  },
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  reporter: 'list',
  webServer: {
    command: 'npm run app:build && npm run app:start',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    stderr: 'pipe',
  },
})
