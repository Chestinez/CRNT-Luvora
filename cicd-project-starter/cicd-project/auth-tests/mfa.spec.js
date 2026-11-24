const { test, expect } = require('@playwright/test');
const factorId = '00fca91c-1cec-4e74-a0e2-5fe6b2c89a7b';
const factor = { id: factorId, name: 'Luvora authenticator', status: 'verified' };
const enabled = { enabled: true, aal: 'aal2', mfaRequired: false, factors: [factor] };
const pending = { enabled: false, aal: 'aal1', mfaRequired: false, factors: [] };
const account = { user: { displayName: 'Alex', email: 'alex@example.com' }, ...enabled };

test('enrolls with a QR and setup key, requires a valid code and clears secrets', async ({
  page,
}) => {
  let verifications = 0;
  await page.route('**/api/auth/mfa', (route) => route.fulfill({ json: pending }));
  await page.route('**/api/auth/mfa/enroll', (route) =>
    route.fulfill({
      status: 201,
      json: {
        factorId,
        qrCode:
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="black"/></svg>',
        secret: 'TESTSETUPKEY',
      },
    }),
  );
  await page.route('**/api/auth/mfa/verify', (route) => {
    verifications += 1;
    expect(route.request().postDataJSON()).toEqual({ factorId, code: '012345' });
    return route.fulfill({ json: { verified: true } });
  });
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: account }));
  await page.goto('/auth/security.html');
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  await expect(page.locator('#qr-code')).toBeVisible();
  await page.getByText('Can’t scan? Use a setup key').click();
  await expect(page.locator('#setup-key')).toHaveText('TESTSETUPKEY');
  await page.getByRole('button', { name: 'Enable two-factor authentication' }).click();
  await expect(page.locator('#code-error')).toHaveText('Enter a six-digit code.');
  expect(verifications).toBe(0);
  await page.getByLabel('Six-digit code').fill('012345');
  await page.getByRole('button', { name: 'Enable two-factor authentication' }).click();
  await expect(page).toHaveURL(/account.html$/);
  await expect(page.locator('#security-state')).toHaveText('Two-factor authentication is on');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('password login redirects to MFA, handles bad codes, then opens account', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/auth/login', (route) => route.fulfill({ json: { mfaRequired: true } }));
  await page.route('**/api/auth/mfa', (route) =>
    route.fulfill({ json: { ...enabled, aal: 'aal1', mfaRequired: true } }),
  );
  await page.route('**/api/auth/mfa/verify', (route) => {
    attempts += 1;
    return route.fulfill({
      status: attempts === 1 ? 400 : 200,
      json:
        attempts === 1
          ? { error: 'That code could not be verified. Use the latest code.' }
          : { verified: true },
    });
  });
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: account }));
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('alex@example.com');
  await page.getByLabel('Password', { exact: true }).fill('existing-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/security.html$/);
  await expect(page.getByRole('heading', { name: 'One more step.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to account' })).toBeHidden();
  await page.getByLabel('Six-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify and log in' }).click();
  await expect(page.getByRole('status')).toContainText('latest code');
  await expect(page.getByRole('button', { name: 'Verify and log in' })).toBeEnabled();
  await page.getByRole('button', { name: 'Verify and log in' }).click();
  await expect(page).toHaveURL(/account.html$/);
});

test('direct account navigation cannot skip the MFA screen', async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { ...account, mfaRequired: true } }),
  );
  await page.route('**/api/auth/mfa', (route) =>
    route.fulfill({ json: { ...enabled, mfaRequired: true } }),
  );
  await page.goto('/auth/account.html');
  await expect(page).toHaveURL(/security.html$/);
  await expect(page.getByRole('button', { name: 'Verify and log in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('mfa.png'), fullPage: true, scale: 'css' });
});

test('removing an authenticator requires an explicit code submission', async ({ page }) => {
  await page.route('**/api/auth/mfa', (route) => route.fulfill({ json: enabled }));
  await page.route('**/api/auth/mfa/disable', (route) => {
    expect(route.request().postDataJSON()).toEqual({ factorId, code: '123456' });
    return route.fulfill({ json: { disabled: true } });
  });
  await page.goto('/auth/security.html');
  await page.getByRole('button', { name: 'Remove an authenticator', exact: true }).click();
  await expect(page.locator('#disable-warning')).toBeVisible();
  await page.getByRole('button', { name: 'Keep authenticator' }).click();
  await expect(page.locator('#mfa-form')).toBeHidden();
  await page.getByRole('button', { name: 'Remove an authenticator', exact: true }).click();
  await page.getByLabel('Six-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify and remove authenticator' }).click();
  await expect(page.getByRole('status')).toContainText('Authenticator removed');
  await expect(page.getByRole('link', { name: 'Go to login' })).toBeVisible();
});

test('cancelling setup clears the key and removes the pending factor', async ({ page }) => {
  await page.route('**/api/auth/mfa', (route) => route.fulfill({ json: pending }));
  await page.route('**/api/auth/mfa/enroll', (route) =>
    route.fulfill({ json: { factorId, qrCode: '<svg/>', secret: 'TESTSECRET' } }),
  );
  await page.route('**/api/auth/mfa/cancel', (route) => route.fulfill({ status: 204 }));
  await page.goto('/auth/security.html');
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  await page.getByRole('button', { name: 'Cancel setup' }).click();
  await expect(page.locator('#setup-key')).toHaveText('');
  await expect(page.locator('#setup-panel')).toBeHidden();
  await expect(page.getByRole('status')).toContainText('still off');
});

test('expired sessions redirect to login, and provider failures can be retried', async ({
  page,
}) => {
  await page.route('**/api/auth/mfa', (route) =>
    route.fulfill({ status: 503, json: { error: 'Temporarily unavailable.' } }),
  );
  await page.goto('/auth/security.html');
  await expect(page.getByRole('status')).toContainText('Temporarily unavailable');
  await expect(page.getByRole('button', { name: 'Reload security settings' })).toBeVisible();
  await page.unroute('**/api/auth/mfa');
  await page.route('**/api/auth/mfa', (route) =>
    route.fulfill({ status: 401, json: { error: 'expired' } }),
  );
  await page.getByRole('button', { name: 'Reload security settings' }).click();
  await expect(page).toHaveURL(/login.html$/);
});
