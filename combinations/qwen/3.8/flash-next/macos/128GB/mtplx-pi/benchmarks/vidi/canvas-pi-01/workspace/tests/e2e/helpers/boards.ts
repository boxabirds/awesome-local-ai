/**
 * Story 5 · e2e helpers for boards that have to *exist* first.
 *
 * Story 3 routing let any address mint a board; story 5 removed that, so an
 * e2e test can no longer `goto('/b/<made-up id>')` and expect a live canvas —
 * it now gets "Board not found", which is the feature. These helpers restore
 * what the old `page.goto('/')` did (open a real, working board) through the
 * path a real visitor takes: ask the Worker for a board, then open its address.
 *
 * Two shapes are provided because the stories need both:
 *  - `openFreshBoard` drives the UI (home → Create a board) and is what the
 *    sharing tests use, so the create button is genuinely exercised;
 *  - `createBoardViaApi` returns an id without rendering anything, for tests
 *    that care about the *document* (two clients, a restart, injected damage)
 *    and would only be slower and flakier if they clicked first.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Ask the Worker for a board and return its id (throws if it did not). */
export async function createBoardViaApi(
  request: APIRequestContext,
  origin = '',
): Promise<string> {
  const response = await request.post(`${origin}/api/boards`);
  expect(response.status(), 'POST /api/boards should create a board').toBe(201);
  const body = (await response.json()) as { id?: string };
  expect(typeof body.id).toBe('string');
  return body.id as string;
}

/** Wait for a board to be mounted *and* synced (no fixed sleep). */
export async function waitForBoard(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __vidi6Live?: { connectionState: () => string };
        }
      ).__vidi6Live?.connectionState() === 'connected',
    undefined,
    { timeout },
  );
}

/**
 * Open a board page at `id`. The address is reached by navigation, exactly as
 * a shared link would be, so the existence check runs for real.
 */
export async function openBoardById(page: Page, id: string): Promise<void> {
  await page.goto(`/b/${id}`);
  await waitForBoard(page);
}

/**
 * Home → "Create a board" → a live board. Returns the board id read back out
 * of the address bar, so the caller can reuse the same room.
 */
export async function openFreshBoard(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByTestId('create-board').click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}/, { timeout: 30_000 });
  await waitForBoard(page);
  const url = new URL(page.url());
  return url.pathname.slice('/b/'.length);
}
