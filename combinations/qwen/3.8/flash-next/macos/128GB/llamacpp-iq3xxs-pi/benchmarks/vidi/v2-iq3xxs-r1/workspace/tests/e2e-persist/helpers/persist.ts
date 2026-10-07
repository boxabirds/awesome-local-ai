import { expect, type Page } from '@playwright/test';

/**
 * Helpers for the persistence e2e project. They sit on top of the story-3 screen
 * helpers but navigate to an explicit `/b/<id>` (the address *is* the board), so a
 * test can reopen the very same board after the Worker process has been restarted.
 */

const BOOT_TIMEOUT_MS = 30_000; // a large board's first paint is allowed to be slower

/** Open `/b/<boardId>` on a server we do not control via Playwright's baseURL. */
export async function gotoBoardUrl(page: Page, url: string, boardId: string): Promise<void> {
  await page.goto(`${url}/b/${boardId}`, { timeout: BOOT_TIMEOUT_MS });
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: BOOT_TIMEOUT_MS });
  await page.waitForFunction(() => typeof (window as any).__vidi6 !== 'undefined', undefined, {
    timeout: BOOT_TIMEOUT_MS,
  });
}

/**
 * Create a board over the running Worker's real API (story 5) and return its id.
 * A board these tests open has to exist server-side first: the Board page now asks
 * "is this board here?" before it paints anything, and a board that was never
 * created is answered with `Board not found`.
 */
export async function createBoard(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`creating a board failed: ${res.status}`);
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error('the server did not return a board id');
  return body.id;
}

/** Fill the live board with `count` notes through the test hook, then wait for them. */
export async function seedBoard(page: Page, count: number): Promise<void> {
  await page.evaluate((n) => (window as any).__vidi6.seedBoard(n), count);
  await expect
    .poll(async () => (await liveNoteIds(page)).length, { timeout: 60_000 })
    .toBe(count);
}

/** Wait until the screen is in sync with its room (a synced board shows no badge). */
export async function waitForSynced(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window as any).__vidi6.getConnectionState()), {
      timeout: 30_000,
    })
    .toBe('connected');
  await expect(page.getByTestId('connection-status')).toHaveCount(0);
}

/** Everything one screen shows, as one comparable string (ids, places, text). */
export function boardSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const notes = Array.from(document.querySelectorAll('[data-note-id]')).map((el) => {
      const box = el.getBoundingClientRect();
      const text = el.querySelector('[data-testid="sticky-text-inner"]')?.textContent ?? '';
      return `${(el as HTMLElement).dataset.noteId}:${Math.round(box.left)},${Math.round(box.top)}:${text}`;
    });
    return notes.sort().join('|');
  });
}

export function liveNoteIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-note-id]')).map(
      (el) => (el as HTMLElement).dataset.noteId ?? '',
    ),
  );
}

/** Drive the board's storage damage / repair hooks (server side, not the browser). */
export async function corruptSnapshot(baseUrl: string, boardId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/__test/boards/${boardId}/corrupt-snapshot`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`corrupt-snapshot failed: ${res.status}`);
}

export async function repairSnapshot(baseUrl: string, boardId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/__test/boards/${boardId}/repair-snapshot`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`repair-snapshot failed: ${res.status}`);
}
