const { defineConfig, devices } = require('@playwright/test');

// Isolated from the team's database-reset setup: these tests never use a DB.
module.exports = defineConfig({
  testDir: '../auth-tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: 2,
  reporter: 'list',
  outputDir: '../test-results/auth',
  use: { baseURL: 'http://127.0.0.1:3012', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'node ../src/server.js',
    url: 'http://127.0.0.1:3012/auth/login.html',
    reuseExistingServer: false,
    env: {
      PORT: '3012',
      APP_ORIGIN: 'http://127.0.0.1:3012',
      DATABASE_URL: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_PUBLISHABLE_KEY: '',
    },
  },
});
