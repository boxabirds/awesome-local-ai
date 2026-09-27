import { expect, test } from '@playwright/test';

// W1 / TC-C03: clean checkout -> install -> migrate -> dev -> landing page and local health.
test('landing page renders and same-origin /health reports local', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Todoodle' })).toBeVisible();
  await expect(page).toHaveTitle('Todoodle');

  const health = await request.get('/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({
    status: 'ok',
    environment: 'local',
    version: 'dev',
    git_sha: 'dev',
    deployed_at: null,
  });
});

test('deep links fall back to the app', async ({ page }) => {
  await page.goto('/w');
  await expect(page.getByRole('heading', { level: 1, name: 'Todoodle' })).toBeVisible();
});
