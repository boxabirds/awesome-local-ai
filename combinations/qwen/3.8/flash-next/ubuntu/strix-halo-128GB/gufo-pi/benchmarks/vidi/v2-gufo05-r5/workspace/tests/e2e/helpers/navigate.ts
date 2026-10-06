/**
 * E2E helpers for navigating to boards with the story 5 routing.
 *
 * With story 5, the home page (`/`) shows "New board", and the board is at `/b/:id`.
 * These helpers navigate the new flow: create a board via the API or click "New board",
 * then wait for the board to appear.
 */
import { expect, type Page } from '@playwright/test';

/**
 * Creates a board via the API and navigates the page to it.
 * Faster than clicking through the home page.
 */
export async function navigateToNewBoard(page: Page): Promise<string> {
  const response = await page.request.post('/api/boards');
  if (!response.ok()) throw new Error(`POST /api/boards failed: ${response.status()}`);
  const { id } = (await response.json()) as { id: string };
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  return id;
}

/**
 * Navigates to the home page, clicks "New board", and waits for the board.
 * Tests the full user flow (TC-26).
 */
export async function createBoardViaHome(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  const url = page.url();
  const match = /\/b\/([A-Za-z0-9_-]{22})/.exec(url);
  if (!match) throw new Error(`after creating a board, URL should be /b/:id, got: ${url}`);
  return match[1]!;
}
