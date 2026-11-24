const { test, expect } = require('@playwright/test');

// Run with configs/playwright-auth.config.js; no database reset or live Auth.

async function fillSignup(page) {
  await page.getByLabel('Display name', { exact: true }).fill('Alex');
  await page.getByLabel('Date of birth', { exact: true }).fill('2000-06-15');
  await page.getByLabel('Email address', { exact: true }).fill('alex@example.com');
  await page.getByLabel('Password', { exact: true }).fill('A-long-password9!');
  await page.getByLabel('Confirm password', { exact: true }).fill('A-long-password9!');
}

test('signup validates required fields, age, password and confirmation', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/auth/signup', (route) => {
    requests += 1;
    return route.fulfill({ status: 202, json: { confirmationRequired: true } });
  });
  await page.goto('/signup');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeFocused();
  await fillSignup(page);
  await page.getByLabel('Date of birth', { exact: true }).fill('2020-01-01');
  await page.getByLabel('Confirm password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('#dateOfBirth-error')).toContainText('18 or older');
  await expect(page.locator('#confirmPassword-error')).toContainText('do not match');
  expect(requests).toBe(0);
  await fillSignup(page);
  await expect(page.locator('[data-met="true"]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible();
  expect(requests).toBe(1);
  await expect(page.locator('#auth-form')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Go to login' })).toBeVisible();
});

test('password visibility works and the layout fits the viewport', async ({ page }) => {
  await page.goto('/auth/signup.html');
  await page.getByLabel('Password', { exact: true }).fill('A-long-password9!');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('signup.png'), fullPage: true });
});

test('login recovers from a rejected attempt, shows account safely and logs out', async ({
  page,
}) => {
  let attempts = 0;
  await page.route('**/api/auth/login', (route) => {
    attempts += 1;
    expect(route.request().headers()['x-luvora-request']).toBe('1');
    return route.fulfill({
      status: attempts === 1 ? 401 : 200,
      json:
        attempts === 1 ? { error: 'Email or password is incorrect.' } : { user: { id: 'test' } },
    });
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: { user: { displayName: '<img src=x onerror=alert(1)>', email: 'alex@example.com' } },
    }),
  );
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 204 }));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('alex@example.com');
  await page.getByLabel('Password', { exact: true }).fill('oldpassword');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('incorrect');
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/account.html$/);
  await expect(page.locator('#account-greeting')).toContainText('<img');
  await expect(page.locator('#account-greeting img')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(/login.html$/);
});

test('failed signup requests preserve values and allow retry', async ({ page }) => {
  await page.route('**/api/auth/signup', (route) => route.abort('failed'));
  await page.goto('/signup');
  await fillSignup(page);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('status')).toContainText('Check your connection and inbox');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('alex@example.com');
  await expect(page.getByRole('button', { name: 'Create my account' })).toBeEnabled();
});

test('expired sessions return to login and confirmation tokens leave the URL', async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 401, json: { error: 'expired' } }),
  );
  await page.goto('/auth/account.html');
  await expect(page).toHaveURL(/login.html$/);
  await page.goto('/auth/login.html#access_token=discard-me&type=signup');
  await expect(page).toHaveURL(/login.html$/);
  await expect(page.getByRole('status')).toContainText('Log in to continue');
});

test('missing local configuration is explained without exposing secrets', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('alex@example.com');
  await page.getByLabel('Password', { exact: true }).fill('oldpassword');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('not configured');
});
