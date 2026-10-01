import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';

/** Creates a board through the real API (story 5) and returns its id. */
export async function createBoardVia(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/boards');
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Creates a board against an absolute server URL (for tests that run their own wrangler process). */
export async function createBoardAt(baseURL: string): Promise<string> {
  const res = await fetch(`${baseURL}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`create board failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

/** Home page → New board → empty board is open. */
export async function openNewBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
}
