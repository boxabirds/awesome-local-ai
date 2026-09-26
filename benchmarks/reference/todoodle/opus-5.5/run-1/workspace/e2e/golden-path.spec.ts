import { expect, test } from '@playwright/test';

// W1 / TC-C03: clean checkout -> bun install -> db:migrate:local -> bun run dev -> landing page + local health.
test('TC-C03 landing page shows Todoodle and same-origin /health reports local', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Todoodle' })).toBeVisible();

  const health = await page.evaluate(async () => {
    const res = await fetch('/health');
    return res.json();
  });
  expect(health).toEqual({ status: 'ok', environment: 'local', version: 'dev', git_sha: 'dev', deployed_at: null });
});
