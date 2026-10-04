/**
 * The honest failure, in a browser.
 *
 * The integration tests can show that a room closes a socket with 4500 when it
 * cannot read a board. This is the part that matters to a person: what the page
 * does with that code — says so, in red, and stops treating the empty screen in
 * front of them as a board they are allowed to write on — and what happens when the
 * board turns out to be fixable, which must not need a reload, a second attempt, or
 * any explanation typed into a support form.
 *
 * TC-24  a board whose snapshot cannot be read: the message, the lock, and the
 *        recovery on the page's own retries
 * plus  the routes that make this case possible existing only where they were asked
 *       for: a deployment without `TEST_HOOKS` does not answer them at all
 *
 * This file is served by the shared e2e server (`npm run e2e:serve` starts it with
 * the test hooks armed), unlike `persistence.spec.ts`, which runs its own.
 */

import { expect, test, type Page } from '@playwright/test';

import { E2E_EVENTUAL_TIMEOUT_MS, LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { boardHooks } from '../fixtures/hooks';
import { getNotes, noteBoxes } from './helpers/notes';
import {
  BoardServer,
  createPersistDirectory,
  removePersistDirectory,
} from './helpers/wrangler-process';

/** Clear of the shared e2e server (28736) and of the persistence cases (28744). */
const HOOKLESS_PORT = 28746;

/** The server `playwright.config.ts` starts for every other e2e case. */
const SHARED_ORIGIN = `http://127.0.0.1:${Number(process.env.VIDI6_E2E_PORT ?? 28736)}`;

/**
 * A point on the visible board that is over no note and no control: double-clicking
 * elsewhere would either edit a note that is already there or press a button, and
 * neither creates one.
 */
async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const boxes = Object.values(await noteBoxes(page));
  for (let y = 140; y <= 700; y += 40) {
    for (let x = 240; x <= 1200; x += 40) {
      const clear = boxes.every(
        (box) => x < box.x - 20 || x > box.right + 20 || y < box.y - 20 || y > box.bottom + 20,
      );
      if (clear) return { x, y };
    }
  }
  throw new Error('no empty stretch of board on screen');
}

test('TC-24: a board that cannot be loaded says so, locks, and comes back on its own', async ({
  browser,
}) => {
  const boardId = newBoardId();
  // The shared server, which `e2e:serve` starts with the hooks armed.
  const hooks = boardHooks(SHARED_ORIGIN);

  // A real board with real notes, safely on disk.
  const seeded = await hooks.seed(boardId, 'retro');
  const saved = await hooks.storedNotes(boardId);
  expect(saved.length).toBeGreaterThan(0);
  expect(seeded.storage.snapshotChunks).toBeGreaterThanOrEqual(1);
  const savedIds = saved.map((note) => note.id).sort();

  // Then the stored snapshot is damaged, and the room that still remembers the
  // board by heart is taken away, so the next person to open it makes a new room
  // read what is on the disk.
  await hooks.corruptSnapshot(boardId);
  await hooks.abort(boardId);

  const context = await browser.newContext();
  const page = await context.newPage();
  // Proof, at the end, that this page was never reloaded: a reload clears the window.
  await page.addInitScript(() => {
    (window as unknown as { __thisPageOpenedOnce?: boolean }).__thisPageOpenedOnce = true;
  });
  await page.goto(`/b/${boardId}`);

  // 1. The message, and nothing else where the board should be.
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState?.()), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: 'the room should refuse the board, and the page should say why',
    })
    .toBe('load_failed');
  const badge = page.getByTestId('connection-status');
  await expect(badge).toHaveText("This board couldn't be loaded. Retrying…");
  await expect(badge).toHaveAttribute('data-state', 'load_failed');
  expect(await getNotes(page)).toHaveLength(0);

  // 2. The board is not editable. An empty board is not an unsaved board: writing
  //    here would make a board this person would have to explain later.
  await expect(page.getByTestId('sticky-note-button')).toBeDisabled();
  await page.mouse.dblclick(640, 400);
  await page.getByTestId('sticky-note-button').click({ force: true }).catch(() => undefined);
  expect(await getNotes(page)).toHaveLength(0);
  // It stays that way while the page retries: the retries are not a recovery.
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionAttempts?.() ?? 0), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBeGreaterThan(1);
  await expect(badge).toHaveText("This board couldn't be loaded. Retrying…");
  expect(await getNotes(page)).toHaveLength(0);

  // 3. The snapshot was only damaged in the test, so it can be put right. Nobody
  //    touches the page from here.
  await hooks.repairSnapshot(boardId);
  // The room will not read the board again more often than this, so the wait is
  // part of the story: the page is patient about a board it cannot see.
  await page.waitForTimeout(LOAD_RETRY_MIN_INTERVAL_MS);

  await expect
    .poll(() => getNotes(page).then((notes) => notes.length), {
      timeout: 60_000,
      message: 'the board should arrive on the page’s own retries',
    })
    .toBe(saved.length);
  await expect(badge).toBeHidden();

  // The board it was, not a board that looks like it.
  const back = await getNotes(page);
  expect(back.map((note) => note.id).sort()).toEqual(savedIds);

  // And it is a board again: creating works, in the same page that was locked.
  await expect(page.getByTestId('sticky-note-button')).toBeEnabled();
  const spot = await emptySpot(page);
  await page.mouse.dblclick(spot.x, spot.y);
  await expect
    .poll(() => getNotes(page).then((notes) => notes.length), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(saved.length + 1);

  expect(
    await page.evaluate(() => (window as unknown as { __thisPageOpenedOnce?: boolean }).__thisPageOpenedOnce),
  ).toBe(true);

  // The rest of the board agrees that this is the same, whole board.
  const status = await hooks.status(boardId);
  expect(status.state).toBe('ready');

  await context.close();
});

test('the test-only routes answer only where they were armed', async () => {
  const boardId = newBoardId();
  // This server was started with TEST_HOOKS=1: the route is a real one.
  const armed = await fetch(`${SHARED_ORIGIN}/__test/boards/${boardId}/status`);
  expect(armed.ok).toBe(true);
  expect(await armed.json()).toHaveProperty('storage');

  // A Worker started the way the deployment config starts it — without that
  // variable — has no such route. The path is an unknown one, and the only thing
  // that answers it is the client bundle's fallback.
  const persistTo = await createPersistDirectory('hookless');
  const plain = new BoardServer({ persistTo, port: HOOKLESS_PORT, testHooks: false });
  await plain.start();
  try {
    const response = await fetch(`${plain.origin}/__test/boards/${boardId}/status`);
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    expect(response.status === 404 || contentType.includes('text/html')).toBe(true);
    expect(body).not.toContain('"storage"');
    expect(body).not.toContain('"loadFailedAt"');
  } finally {
    await plain.stop();
    await removePersistDirectory(persistTo);
  }
});
