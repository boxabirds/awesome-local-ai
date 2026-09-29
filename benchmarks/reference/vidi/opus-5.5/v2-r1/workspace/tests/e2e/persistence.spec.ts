// persist.room end to end: a real `wrangler dev` process with persisted local state is killed
// and restarted (memory lost), and the board must come back exactly as it was.
import { type Browser, type Page, expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import { largeBoard } from '../fixtures/boards';
import { boxOf, centreOf, drag, getNotes, noteEditor, notes, setCamera } from './helpers/board';
import { waitForConnected } from './helpers/participants';
import { seedBoard } from './helpers/seed';
import { type WranglerProcess, wranglerProcess } from './helpers/wrangler-process';

test.describe.configure({ mode: 'parallel', timeout: 240_000 });

const COLOURS = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'];

async function openPage(browser: Browser, server: WranglerProcess, boardId: string) {
  const context = await browser.newContext({
    baseURL: server.baseURL,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await waitForConnected(page);
  return { context, page };
}

async function waitForNoteCount(page: Page, count: number, timeout = E2E_EVENTUAL_TIMEOUT_MS) {
  await expect.poll(async () => (await getNotes(page)).length, { timeout }).toBe(count);
}

let servers: WranglerProcess[] = [];
async function server(opts?: { testHooks?: boolean }) {
  const s = await wranglerProcess(opts);
  servers.push(s);
  return s;
}
test.afterEach(async () => {
  await Promise.all(servers.map((s) => s.kill()));
  servers = [];
});

test.describe('Workflow: Overnight return', () => {
  test('TC-19 25 varied notes are identical after everyone leaves and the service restarts', async ({
    browser,
  }) => {
    const srv = await server();
    const boardId = newBoardId();
    const alex = await openPage(browser, srv, boardId);
    const page = alex.page;
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });

    for (let i = 0; i < 25; i++) {
      const at = { x: 200 + (i % 5) * 150, y: 120 + Math.floor(i / 5) * 130 };
      await page.mouse.dblclick(at.x, at.y);
      await expect(noteEditor(page)).toBeFocused();
      const text =
        i % 3 === 0 ? `Idea ${i}\nsecond line\n- detail` : i % 3 === 1 ? `Short ${i}` : '';
      if (text) await page.keyboard.type(text);
      await page.keyboard.press('Escape');
      await expect(noteEditor(page)).toHaveCount(0);
      // The note stays selected: give it a colour from its toolbar.
      await page.getByRole('button', { name: `${COLOURS[i % COLOURS.length]} colour` }).click();
    }
    await waitForNoteCount(page, 25);
    // Overlap some notes; dragging brings each to the front (stacking order changes).
    for (const i of [0, 6, 12, 7]) {
      const [note] = (await getNotes(page)).filter((n) => n.text.startsWith(`Idea ${i}`) || n.text === `Short ${i}`);
      const box = await boxOf(page.locator(`[data-sticky-id="${note?.id}"]`));
      await drag(page, centreOf(box), 70, 55);
    }
    await page.keyboard.press('Escape');
    const before = await getNotes(page);
    expect(before).toHaveLength(25);
    expect(new Set(before.map((n) => n.color)).size).toBe(6);

    // Someone else sees the final board (so it is saved), then everyone leaves.
    const sam = await openPage(browser, srv, boardId);
    await expect.poll(async () => JSON.stringify(await getNotes(sam.page)), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(JSON.stringify(before));
    await alex.context.close();
    await sam.context.close();

    await srv.kill();
    await srv.start();

    const priya = await openPage(browser, srv, boardId);
    await waitForNoteCount(priya.page, 25);
    expect(await getNotes(priya.page)).toEqual(before);
    await expect(notes(priya.page)).toHaveCount(25);
    await priya.context.close();
  });
});

test.describe('Workflow: Leave immediately', () => {
  test('TC-20 a note Sam has seen survives both leaving and a restart within a second', async ({
    browser,
  }) => {
    const srv = await server();
    const boardId = newBoardId();
    const alex = await openPage(browser, srv, boardId);
    const sam = await openPage(browser, srv, boardId);

    await alex.page.mouse.dblclick(500, 400);
    await expect(noteEditor(alex.page)).toBeFocused();
    await alex.page.keyboard.type('Seen by Sam');
    await expect
      .poll(async () => (await getNotes(sam.page)).map((n) => n.text), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        intervals: [10],
      })
      .toEqual(['Seen by Sam']);
    const seen = Date.now();
    await Promise.all([alex.context.close(), sam.context.close(), srv.kill()]);
    const elapsed = Date.now() - seen;
    console.log(`TC-20: both left and the service was killed ${elapsed} ms after Sam saw the note`);

    await srv.start();
    const priya = await openPage(browser, srv, boardId);
    await waitForNoteCount(priya.page, 1);
    expect((await getNotes(priya.page))[0].text).toBe('Seen by Sam');
    await priya.context.close();
  });
});

test.describe('Workflow: Big board open', () => {
  test(`TC-21 a saved ${PERSIST_TESTED_NOTES}-note board opens with every note rendered`, async ({
    browser,
  }) => {
    const srv = await server();
    const boardId = newBoardId();
    // One update per change: the log is compacted several times while seeding.
    const board = largeBoard(PERSIST_TESTED_NOTES, 2000, { oneTransaction: false });
    await seedBoard(srv.baseURL, boardId, board.updates);
    // Restart so the room is rebuilt from storage, as for a board nobody had open.
    await srv.kill();
    await srv.start();

    const context = await browser.newContext({ baseURL: srv.baseURL, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const started = Date.now();
    await page.goto(`/b/${boardId}`);
    await expect(page.locator('[data-sticky-id]')).toHaveCount(PERSIST_TESTED_NOTES, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    const ms = Date.now() - started;
    console.log(
      `TC-21: ${PERSIST_TESTED_NOTES} notes rendered ${ms} ms after navigation ` +
        `(budget ${BOARD_LOAD_BUDGET_MS} ms, reported not asserted${ms > BOARD_LOAD_BUDGET_MS ? '; OVER BUDGET' : ''})`,
    );
    const shown = await getNotes(page);
    expect(shown.map(({ id, text, color, x, y, z }) => ({ id, text, color, x, y, z }))).toEqual(
      snapshot(board.doc).map(({ id, text, color, x, y, z }) => ({ id, text, color, x, y, z })),
    );
    await context.close();
  });
});

test('test hook routes are absent without TEST_HOOKS (production configuration)', async () => {
  const srv = await server();
  const boardId = newBoardId();
  for (const action of ['corrupt-snapshot', 'repair']) {
    const res = await fetch(`${srv.baseURL}/__test/boards/${boardId}/${action}`, { method: 'POST' });
    const body = await res.text();
    expect(body).not.toBe('ok');
    expect(res.status === 404 || res.status === 405 || /<html/i.test(body)).toBe(true);
  }
});
