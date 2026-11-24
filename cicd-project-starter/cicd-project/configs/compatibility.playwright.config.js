const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: '../e2e-tests',
  testMatch: 'compatibility.spec.js',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { browserName: 'chromium', headless: true },
});
