import { expect, test } from '@playwright/test';

// W2 / TC-P17: baseline protections on a real document load, and nothing leaves the origin.
test('document carries baseline headers, suppresses referrer and stays same-origin', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin;
  const requested: string[] = [];
  page.on('request', (req) => requested.push(req.url()));

  const response = await page.goto('/');
  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['content-security-policy']).toBe(
    "default-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'",
  );
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  await page.waitForLoadState('networkidle');

  expect(requested.length).toBeGreaterThan(0);
  const foreign = requested.filter((url) => !url.startsWith('data:') && new URL(url).origin !== origin);
  expect(foreign).toEqual([]);
});
