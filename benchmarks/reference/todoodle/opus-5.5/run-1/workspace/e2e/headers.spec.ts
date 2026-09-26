import { expect, test } from '@playwright/test';

// W2 / TC-P17: baseline protections on a real document load, and nothing leaves the origin.
test('TC-P17 document response carries baseline headers and every request is same-origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const requested: string[] = [];
  const consoleErrors: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const response = await page.goto('/');
  expect(response).not.toBeNull();
  const headers = response!.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['content-security-policy']).toBe("default-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'");
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  await expect(page.getByRole('heading', { level: 1, name: 'Todoodle' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(requested.length).toBeGreaterThan(0);
  for (const url of requested) {
    expect(new URL(url).origin, `request to ${url}`).toBe(origin);
  }
  // The CSP blocks nothing the app needs (violations surface as console errors).
  expect(consoleErrors).toEqual([]);
});
