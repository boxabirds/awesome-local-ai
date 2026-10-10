/**
 * Shared plumbing for the sharing e2e specs (story 5), and for every older spec
 * that needs a board to exist before it can be used.
 *
 * A board is made by the server now, so the suites get their boards the same way
 * a person does: either the app's own **New board** button, in the specs that are
 * about the board; or `POST /api/boards` on the same origin, in the specs that are
 * about two people on one link and need the address in hand before the first page
 * opens.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { BOARD_ID_PATTERN } from '../../../src/shared/board-id';

/** The path a board lives at, as the app writes it. */
export const boardPath = (boardId: string): string => `/b/${boardId}`;

/** `POST /api/boards`, and the id it promises to nobody else. */
export async function createBoard(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/boards');
  const detail = await response.text().catch(() => '<no body>');
  expect(response.status(), `POST /api/boards: ${detail}`).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id === 'string' ? body.id : '').toMatch(BOARD_ID_PATTERN);
  return body.id as string;
}

/** `GET /api/boards/:id`, as a yes or a no. */
export async function boardExists(request: APIRequestContext, boardId: string): Promise<boolean> {
  const response = await request.get(`/api/boards/${boardId}`);
  return response.status() === 200;
}

/**
 * A board nobody has been on, opened the way a person opens it: home page, **New
 * board**, and the app is standing on the board's link. Returns the address, so a
 * spec can hand it to a second browser.
 */
export async function openFreshBoard(page: Page): Promise<string> {
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.getByTestId('board-app')).toBeVisible();
  const boardId = boardIdFromUrl(page.url());
  expect(boardId).toMatch(BOARD_ID_PATTERN);
  return boardId;
}

/** The board a URL is about, or an empty string when it is not about a board. */
export function boardIdFromUrl(url: string): string {
  const path = new URL(url).pathname;
  return path.startsWith('/b/') ? path.slice('/b/'.length) : '';
}

/**
 * Put a board into the shape a board had before this story: logged changes and no
 * `created_at` (`POST /__test/boards/:id/seed-legacy`, live only when the server
 * runs with `TEST_HOOKS=1`). The notes it writes are known here, because the
 * server writes real ones through the real board model (`legacyNotes`).
 */
export async function seedLegacyBoard(
  request: APIRequestContext,
  boardId: string,
  notes: number,
): Promise<string[]> {
  const response = await request.post(`/__test/boards/${boardId}/seed-legacy`, {
    data: { notes },
  });
  const detail = await response.text().catch(() => '<no body>');
  // A 404 here means the test hooks are off, and that is a broken server, not a
  // board that does not exist.
  expect(response.status(), `seed-legacy: ${detail}`).toBe(200);
  const body = (await response.json()) as { notes?: number; texts?: unknown };
  expect(body.notes, 'the server seeded a different number of notes than it was told').toBe(
    notes,
  );
  expect(Array.isArray(body.texts) ? body.texts.length : -1).toBe(notes);
  return body.texts as string[];
}
