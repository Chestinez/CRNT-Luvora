const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const bank = require('../src/data/compatibilityQuestions');
const base = 'https://luvora.test';

test.beforeEach(async ({ page }) => {
  let assessment = null;
  await page.route(`${base}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/api/compatibility/questions')
      return json({
        questions: bank.QUESTIONS,
        categories: bank.CATEGORIES,
        version: bank.QUESTIONNAIRE_VERSION,
      });
    if (url.pathname === '/api/compatibility/assessment') {
      const body = req.postDataJSON();
      if (req.method() === 'GET') return json({ assessment });
      if (req.method() === 'POST') {
        if (assessment) return json({ error: 'Already exists' }, 409);
        assessment = {
          revision: 1,
          questionnaire_version: bank.QUESTIONNAIRE_VERSION,
          answers: {},
          partner_preferences: {},
          skipped_question_ids: [],
          core_completed_at: null,
        };
        return json({ assessment }, 201);
      }
      if (body.revision !== assessment?.revision)
        return json({ error: 'Your answers changed in another tab. Reload first.' }, 409);
      if (req.method() === 'DELETE') {
        assessment = null;
        return route.fulfill({ status: 204 });
      }
      assessment = {
        ...assessment,
        revision: assessment.revision + 1,
        answers: body.answers,
        partner_preferences: body.partnerPreferences,
        skipped_question_ids: body.skippedQuestionIds,
        core_completed_at:
          body.action === 'complete' ? new Date().toISOString() : assessment.core_completed_at,
      };
      return json({ assessment });
    }
    let file = url.pathname === '/compatibility/' ? '/compatibility/index.html' : url.pathname;
    if (!/^\/compatibility\/[a-z.-]+$/.test(file))
      return route.fulfill({ status: 404, body: 'Not found' });
    const body = await fs.readFile(path.join(__dirname, '../src/public', file));
    const contentType = file.endsWith('.js')
      ? 'application/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : 'text/html';
    return route.fulfill({ body, contentType });
  });
});

test('autosaves, resumes, edits preferences, completes 15 questions and deletes', async ({
  page,
}) => {
  await page.goto(`${base}/compatibility/`);
  await expect(page.locator('#position')).toHaveText('Question 1 of 15');
  await expect(page.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
  await page.locator('#options input').first().check();
  await expect(page.locator('#save-status')).toHaveText('Saved.');
  await page.reload();
  await expect(page.locator('#position')).toHaveText('Question 2 of 15');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('#options input').first()).toBeChecked();
  await page.locator('#use-preference').check();
  await page.locator('#partner-options input').first().check();
  await page.locator('#importance').selectOption('3');
  await page.locator('#dealbreaker').check();
  await expect(page.locator('#save-status')).toHaveText('Saved.');
  for (let i = 0; i < 15; i += 1) {
    await expect(page.locator('#position')).toHaveText(`Question ${i + 1} of 15`);
    await page.locator('#options input').first().check();
    await page.locator('#next').click();
  }
  await expect(page).toHaveURL(`${base}/compatibility/enhance.html`);
  await expect(page.locator('#status')).toHaveText('Your core preferences are saved.');
  await expect(page.getByRole('link', { name: /five more/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Explore my personality/ })).toHaveAttribute(
    'href',
    '/personality/',
  );
  await page.locator('#core').click();
  await expect(page.locator('#use-preference')).toBeChecked();
  await expect(page.locator('#dealbreaker')).toBeChecked();
  await page.goto(`${base}/compatibility/enhance.html`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#delete').click();
  await expect(page.locator('#delete')).toBeHidden();
});

test('mobile layout fits and missing answers cannot continue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/compatibility/`);
  await page.locator('#next').click();
  await expect(page.locator('#notice')).toContainText('Choose an answer');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('stale tab cannot overwrite a newer saved answer', async ({ page }) => {
  await page.goto(`${base}/compatibility/`);
  await expect(page.locator('#quiz')).toBeVisible();
  await page.evaluate(async () => {
    const { assessment } = await (await fetch('/api/compatibility/assessment')).json();
    await fetch('/api/compatibility/assessment', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: assessment.revision,
        action: 'draft',
        answers: { 'goals-01': ['casual'] },
        partnerPreferences: {},
        skippedQuestionIds: [],
      }),
    });
  });
  await page.locator('#options input').first().check();
  await expect(page.locator('#notice')).toContainText('another tab');
  await expect(page.locator('#next')).toBeDisabled();
  await expect(page.locator('#retry')).toBeVisible();
});
