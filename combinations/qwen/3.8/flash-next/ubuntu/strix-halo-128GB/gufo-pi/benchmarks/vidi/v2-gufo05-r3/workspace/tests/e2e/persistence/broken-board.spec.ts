/**
 * A board that cannot be read, in a real browser (story 4, task 9): TC-24.
 *
 * Runs in the `persistence` project against the dev server whose test hooks are
 * switched on (`TEST_HOOKS=1` there, and nowhere else — the companion spec
 * `storage-hooks-not-in-production.spec.ts` checks exactly that).
 *
 * The three things a person should be able to rely on: a board that cannot be read
 * is reported instead of being shown as an empty one; it cannot be edited while
 * that is true; and when the storage heals, the board arrives by itself, with no
 * reload and nothing typed in the wrong place in the meantime.
 */
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

import { LOAD_RETRY_MIN_INTERVAL_MS, RECONNECT_MAX_BACKOFF_MS } from '../../../src/shared/config';
import { snapshot } from '../../../src/shared/board-model';
import { encodeBoard, retroBoard } from '../../fixtures/boards';
import {
  boardKey,
  boardOf,
  closeParticipants,
  expectEventually,
  freshBoardId,
  openParticipant,
} from '../helpers/participants';
import {
  createStickyByButton,
  getBoard,
  notes,
  stopEditing,
} from '../helpers/sticky-notes';
import {
  PERSISTENCE_INSPECTOR_PORT,
  PERSISTENCE_PORT,
  startWrangler,
  type WranglerServer,
} from '../helpers/wrangler-process';

/** Long enough for a reconnect attempt: the retry gate plus the provider's backoff. */
const RETRY_WAIT_MS = LOAD_RETRY_MIN_INTERVAL_MS + RECONNECT_MAX_BACKOFF_MS + 15_000;

let server: WranglerServer;

test.beforeAll(async () => {
  server = await startWrangler({
    port: PERSISTENCE_PORT,
    inspectorPort: PERSISTENCE_INSPECTOR_PORT,
    testHooks: '1',
  });
});

test.afterAll(async () => {
  await server.dispose();
});

async function callHook(
  request: APIRequestContext,
  boardId: string,
  hook: 'seed' | 'compact' | 'corrupt-snapshot' | 'repair',
  body?: Uint8Array,
): Promise<Record<string, unknown>> {
  const response = await request.post(`/__test/boards/${boardId}/${hook}`, {
    // A Buffer is sent as-is; a Uint8Array would be treated as an object and
    // JSON-stringified into garbage the room cannot decode.
    data: Buffer.from(body ?? new Uint8Array(0)),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  expect(payload, `${hook} responded: ${JSON.stringify(payload)}`).toMatchObject({ ok: true });
  return payload;
}

/** A tab opened without waiting for a board that may never arrive. */
async function openTab(browser: Parameters<typeof openParticipant>[0], boardId: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-board-surface]');
  return { context, page };
}

async function badgeState(page: Page): Promise<string> {
  return (await page.locator('[data-connection-state]').getAttribute('data-connection-state')) ?? '';
}

test.describe('broken board (TC-24)', () => {
  test.setTimeout(300_000);

  test('reports the unreadable board, refuses edits, and recovers without a reload', async ({
    browser,
    request,
  }) => {
    const boardId = freshBoardId();
    const fixture = retroBoard();
    const saved = boardKey(snapshot(fixture.doc));

    // A saved board: 25 notes, folded into a snapshot, and then that snapshot is
    // damaged in place. From here the room cannot read the board it is in charge of.
    expect((await callHook(request, boardId, 'seed', encodeBoard(fixture.doc))).notes).toBe(25);
    expect((await callHook(request, boardId, 'compact')).chunks).toBe(1);
    expect(await callHook(request, boardId, 'corrupt-snapshot')).toMatchObject({
      corruptedChunk: 0,
    });

    // Somebody opens the board. They are not shown an empty one.
    const first = await openTab(browser, boardId);
    await expect
      .poll(() => badgeState(first.page), { timeout: 30_000 })
      .toBe('load_failed');
    await expect(first.page.locator('[data-connection-state]')).toContainText(
      'This board couldn’t be loaded. Retrying…',
    );
    await expect(notes(first.page)).toHaveCount(0);

    // And they cannot change it: the button is off, and a double-click on the
    // board makes nothing.
    const createButton = first.page.getByRole('button', { name: 'Sticky note' });
    await expect(createButton).toBeDisabled();
    const surface = first.page.locator('[data-board-surface]');
    await surface.dblclick({ position: { x: 400, y: 300 } });
    await expect(notes(first.page)).toHaveCount(0);
    expect(await getBoard(first.page)).toHaveLength(0);

    // The storage heals.
    await callHook(request, boardId, 'repair');

    // The same tab, with nothing clicked and the page never reloaded, gets the
    // board: the connection keeps retrying and the retry gate has passed.
    await expectEventually(
      'TC-24 Board loads after the repair',
      () => getBoard(first.page),
      (board) => board.length === 25,
      RETRY_WAIT_MS,
    );
    await expect(first.page.locator('[data-connection-state]')).toHaveCount(0);
    expect(boardKey(await getBoard(first.page))).toBe(saved);

    // Editing is back.
    await expect(createButton).toBeEnabled();
    await createStickyByButton(first.page);
    await first.page.keyboard.type('back to work');
    await stopEditing(first.page);
    const after = await getBoard(first.page);
    expect(after).toHaveLength(26);
    expect(after.some((note) => note.text === 'back to work')).toBe(true);

    // And the room is saving again: another tab sees the new note.
    const second = await openParticipant(browser, 'Sam', boardId);
    expect(boardKey(await boardOf(second))).toBe(boardKey(after));

    await closeParticipants([second]);
    await first.context.close();
  });
});
