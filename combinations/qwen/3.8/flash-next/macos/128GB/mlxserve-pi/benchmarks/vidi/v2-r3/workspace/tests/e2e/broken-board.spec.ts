// Story 4, `persist.load_failure` end to end (TC-24).
//
// A board whose storage cannot be read must say so — with the load-failure badge —
// instead of pretending to be empty, and must recover, whole, once the storage is
// readable again. There is no broken disk to wait for in a browser test, so the
// test-only storage hooks break and mend the saved board on demand: the badge is
// then driven by the room's real 4500 close and the recovery by the room's real
// reload, over the live connection.
//
// Runs against its own server (port 4182) with the storage hooks enabled, so it
// owns both the process and the corruption; every navigation is to an absolute
// origin.
import { expect, test } from '@playwright/test';
import { settle } from './helpers/board';
import { createNoteAt, noteIds, noteText } from './helpers/stickies';
import { PersistentWrangler } from './helpers/wrangler-process';

const PORT = 4182;
const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

let wrangler: PersistentWrangler;

test.beforeAll(async () => {
  wrangler = new PersistentWrangler({ port: PORT });
  await wrangler.start();
});

test.afterAll(async () => {
  await wrangler?.dispose();
});

function boardIdOf(url: string): string {
  return new URL(url).pathname.replace(/^\/b\//, '');
}

test('TC-24: an unreadable board says so, and comes back whole once it can be read', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const boardUrl = await openBoard(page);
  const boardId = boardIdOf(boardUrl);

  // A note, so the saved board has something worth coming back for. It is echoed
  // back to this page only after the room has stored it, so when it is seen the
  // room certainly holds it and the corruption has something to damage.
  const id = await createNoteAt(page, { x: 500, y: 400 }, 'must survive');
  await settle(page);

  // Nothing is broken yet: no badge, and the board reads as itself.
  await expect(page.getByText(LOAD_FAILED_TEXT)).toHaveCount(0);

  // Break the saved board. The room discards its in-memory document and closes
  // this page's connection with the load-failure code — the same close a real
  // unreadable board produces.
  const corrupted = await wrangler.hook(boardId, 'corrupt-snapshot');
  expect(corrupted.ok).toBe(true);

  // The badge appears, and the board is not served as an empty one: the note the
  // page still holds is not confirmed by the room, and no new empty board shows.
  await expect(page.getByText(LOAD_FAILED_TEXT)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('connection-status')).toHaveAttribute('role', 'status');

  // Mend it. The next reconnect reads the board back from disk.
  const repaired = await wrangler.hook(boardId, 'repair');
  expect(repaired.ok).toBe(true);

  // Recovery over the live connection: the badge clears and the note is there.
  // The client retries on its own backoff, so this may take a few seconds.
  await expect(page.getByText(LOAD_FAILED_TEXT)).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-note-id]').length > 0, undefined, {
    timeout: 30_000,
  });
  await settle(page);
  await expect(page.locator(`[data-note-id="${id}"]`)).toBeVisible();
  expect(await noteText(page, id)).toBe('must survive');
  expect((await noteIds(page)).length).toBe(1);

  await context.close();
});

/** Open a board at this spec's own server and wait for the app to be ready. */
async function openBoard(page: import('@playwright/test').Page): Promise<string> {
  // Story 5: `/` is the Home page and a board is the server's to create, so a
  // board is opened by clicking New board — the same POST /api/boards the app
  // makes — which leaves the browser on the new board's own `/b/<id>` address.
  await page.goto(`${wrangler.origin}/`);
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/, { timeout: 20_000 });
  await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('100%', { timeout: 20_000 });
  await page.waitForFunction(
    () =>
      window.__vidi6 !== undefined &&
      window.__vidi6.getCamera().x === -window.innerWidth / 2 &&
      window.__vidi6.getCamera().y === -window.innerHeight / 2,
  );
  await settle(page);
  return page.url();
}
