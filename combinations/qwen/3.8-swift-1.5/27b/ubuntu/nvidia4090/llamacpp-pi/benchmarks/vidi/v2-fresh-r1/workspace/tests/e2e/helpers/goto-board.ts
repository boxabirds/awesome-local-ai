// Helper: navigate to a fresh board (creates one via the API).
import type { Page } from '@playwright/test';

/**
 * Create a board via the API and navigate the page to it.
 * Use in test.beforeEach for tests that need a board.
 */
export async function gotoFreshBoard(page: Page): Promise<string> {
  const res = await page.request.post('/api/boards');
  if (res.status() !== 201) {
    throw new Error(`Failed to create board: HTTP ${res.status()}`);
  }
  const { id } = await res.json();
  await page.goto(`/b/${id}`);
  await page.getByTestId('app-root').waitFor();
  return id;
}
