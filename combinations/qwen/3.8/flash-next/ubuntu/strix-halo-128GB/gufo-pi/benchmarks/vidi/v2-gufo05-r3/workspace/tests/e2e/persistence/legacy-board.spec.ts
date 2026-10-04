/**
 * A board that predates the share feature (story 5, task 6): TC-31.
 *
 * Runs in the `persistence` project, where the dev server has test hooks on. The
 * seed hook writes a board's rows directly and does NOT record the creation marker
 * — exactly what boards created before story 5 look like. A link to such a board
 * must open it normally: existence recognises rows as "a board", not only a board
 * made by the new create endpoint.
 */
import { expect, test } from '@playwright/test';

import { encodeBoard, retroBoard } from '../../fixtures/boards';
import { freshBoardId } from '../helpers/participants';
import { notes } from '../helpers/sticky-notes';
import {
  PERSISTENCE_INSPECTOR_PORT,
  PERSISTENCE_PORT,
  startWrangler,
  type WranglerServer,
} from '../helpers/wrangler-process';

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

test.describe('a board that predates the feature (TC-31)', () => {
  test.setTimeout(180_000);

  test('opens normally from its link', async ({ browser, request }) => {
    const boardId = freshBoardId();
    const fixture = retroBoard();

    // Seed rows only — no creation marker, so this is a pre-feature board.
    const response = await request.post(`/__test/boards/${boardId}/seed`, {
      // A Buffer is sent as-is; a Uint8Array would be JSON-stringified into garbage.
      data: Buffer.from(encodeBoard(fixture.doc)),
    });
    const payload = (await response.json()) as { ok: boolean; notes: number };
    expect(payload).toMatchObject({ ok: true });
    const savedNotes = payload.notes;
    expect(savedNotes).toBeGreaterThan(0);

    // Existence treats the board as there, even though it was never "created".
    expect((await request.get(`/api/boards/${boardId}`)).status()).toBe(200);

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-board-surface]', { timeout: 30_000 });

    // Not the Board not found page — the real board, with its content.
    await expect(page.getByTestId('not-found-page')).toHaveCount(0);
    await expect(notes(page)).toHaveCount(savedNotes, { timeout: 30_000 });

    await context.close();
  });
});
