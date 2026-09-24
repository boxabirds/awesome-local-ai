/**
 * persist.room end to end, against real `wrangler dev` processes that are SIGKILLed and
 * restarted over the same `--persist-to` storage: nothing survives in memory, so whatever
 * reappears was saved. Runs in the `persistence` project (Chromium), one process per test.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { largeBoard } from '../fixtures/boards';
import { getNotes, noteLocator, type NoteState } from './helpers/board';
import { boardUrl, editingNoteId, renderedNote, renderedNotes, waitConnected } from './helpers/participants';
import { compactBoard, seedBoard } from './helpers/seed';
import { wranglerServer, type WranglerServer } from './helpers/wrangler-process';

/** Each test gets its own port and inspector port (tests may run in parallel). */
const PORTS = { overnight: [8791, 9291], leave: [8792, 9292], big: [8793, 9293] } as const;
const NOTES_TO_CREATE = 25;
const GRID_COLUMNS = 5;
/** Click points closer than a note (200 px) so neighbours overlap, but never on an existing note. */
const GRID_ORIGIN = { x: 260, y: 150 } as const;
const GRID_STEP = { x: 150, y: 110 } as const;
const COLOURS = ['Orange colour', 'Green colour', 'Blue colour', 'Pink colour', 'Violet colour'] as const;
const TEXTS = [
  'Went well: release train on time',
  'To improve:\nflaky checkout tests',
  'Action: pair on test isolation',
  'Standups ran long',
  'Great support from platform 🎉',
];
const DRAG = { dx: 30, dy: 20, steps: 8 } as const;
/** "Within one second" of the change appearing for Sam (PRD persist.seen_is_saved). */
const LEAVE_WITHIN_MS = 1000;
const PERSISTENCE_TEST_TIMEOUT_MS = 300_000;
const LOAD_WAIT_MS = 60_000;

test.describe.configure({ timeout: PERSISTENCE_TEST_TIMEOUT_MS });

let server: WranglerServer | null = null;
test.afterEach(async () => {
  await server?.dispose();
  server = null;
});

async function openBoard(browser: Browser, base: string, boardId: string): Promise<{ context: BrowserContext; page: Page }> {
  const { viewport } = test.info().project.use;
  const context = await browser.newContext({ baseURL: base, viewport });
  const page = await context.newPage();
  await page.goto(boardUrl(boardId));
  await waitConnected(page);
  return { context, page };
}

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Note text' });
}

/** Creates a note by double-clicking empty board, types `text`, ends editing (note stays selected). */
async function createNote(page: Page, at: { x: number; y: number }, text: string): Promise<string> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(editor(page)).toBeFocused();
  const id = await editingNoteId(page);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  return id;
}

function comparable(notes: NoteState[]) {
  return notes.map(({ id, x, y, color, text, z }) => ({ id, x, y, color, text, z }));
}

test('Workflow "Overnight return" TC-19: 25 varied notes survive closing every browser and a process restart', async ({
  browser,
}) => {
  server = wranglerServer(...PORTS.overnight);
  await server.start();
  const boardId = newBoardId();
  const first = await openBoard(browser, server.baseURL, boardId);
  const page = first.page;

  for (let i = 0; i < NOTES_TO_CREATE; i += 1) {
    const at = {
      x: GRID_ORIGIN.x + (i % GRID_COLUMNS) * GRID_STEP.x,
      y: GRID_ORIGIN.y + Math.floor(i / GRID_COLUMNS) * GRID_STEP.y,
    };
    await createNote(page, at, `${i + 1}. ${TEXTS[i % TEXTS.length]}`);
    if (i % 2 === 0) {
      await page.getByRole('button', { name: COLOURS[i % COLOURS.length] }).click();
    }
  }
  // Lift and move the first note: stacking now differs from creation order.
  const firstId = (await getNotes(page)).sort((a, b) => a.z - b.z)[0]!.id;
  const box = (await noteLocator(page, firstId).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + DRAG.dx, box.y + box.height / 2 + DRAG.dy, { steps: DRAG.steps });
  await page.mouse.up();

  await expect.poll(async () => (await getNotes(page)).length).toBe(NOTES_TO_CREATE);
  const before = comparable(await getNotes(page));
  expect(new Set(before.map((n) => n.color)).size).toBeGreaterThan(1);
  expect(before.at(-1)!.id).toBe(firstId);
  // Everything shown locally has reached the room: a second person sees the same board.
  const witness = await openBoard(browser, server.baseURL, boardId);
  await expect.poll(async () => comparable(await getNotes(witness.page))).toEqual(before);
  const renderedBefore = await renderedNotes(page);

  await Promise.all([first.context.close(), witness.context.close()]);
  await server.kill();
  await server.start();

  const next = await openBoard(browser, server.baseURL, boardId);
  await expect(noteLocator(next.page)).toHaveCount(NOTES_TO_CREATE);
  expect(comparable(await getNotes(next.page))).toEqual(before);
  expect(await renderedNotes(next.page)).toEqual(renderedBefore);
  await next.context.close();
});

test('Workflow "Leave immediately" TC-20: a note Sam has seen survives both leaving and a kill within 1 s', async ({
  browser,
}) => {
  server = wranglerServer(...PORTS.leave);
  await server.start();
  const boardId = newBoardId();
  const alex = await openBoard(browser, server.baseURL, boardId);
  const sam = await openBoard(browser, server.baseURL, boardId);

  const id = await createNote(alex.page, { x: 500, y: 350 }, 'Decision: ship on Friday');
  await expect
    .poll(async () => (await renderedNote(sam.page, id))?.text, { intervals: [10] })
    .toBe('Decision: ship on Friday');
  const seenAt = Date.now();
  // Both people leave and the process is SIGKILLed at once (kill() then waits for the port).
  const leaving = Promise.all([alex.context.close(), sam.context.close(), server.kill()]);
  const issuedAfterMs = Date.now() - seenAt;
  await leaving;
  console.info(`TC-20 leave + kill issued ${issuedAfterMs} ms after Sam saw the note`);
  expect(issuedAfterMs).toBeLessThan(LEAVE_WITHIN_MS);

  await server.start();
  const again = await openBoard(browser, server.baseURL, boardId);
  await expect.poll(async () => (await renderedNote(again.page, id))?.text).toBe('Decision: ship on Friday');
  expect(await getNotes(again.page)).toHaveLength(1);
  await again.context.close();
});

test(`Workflow "Big board open" TC-21: a saved ${PERSIST_TESTED_NOTES}-note board shows every note within BOARD_LOAD_BUDGET_MS`, async ({
  browser,
}) => {
  server = wranglerServer(...PORTS.big);
  await server.start();
  const boardId = newBoardId();
  const board = largeBoard();
  await seedBoard(server.baseURL, boardId, board);
  expect(await compactBoard(server.baseURL, boardId)).toBe(true);
  // A fresh process: the room loads the snapshot from storage when the page connects.
  await server.kill();
  await server.start();

  const { viewport } = test.info().project.use;
  const context = await browser.newContext({ baseURL: server.baseURL, viewport });
  const page = await context.newPage();
  await page.goto(boardUrl(boardId), { waitUntil: 'commit' });
  const syncedAt = page.waitForFunction(
    () => (window.__vidi6?.connectionState === 'connected' ? performance.now() : false),
    undefined,
    { timeout: LOAD_WAIT_MS, polling: 'raf' },
  );
  const shownAt = await page.waitForFunction(
    (count) =>
      document.querySelectorAll('[role="group"][aria-label="Sticky note"]').length >= count ? performance.now() : false,
    PERSIST_TESTED_NOTES,
    { timeout: LOAD_WAIT_MS, polling: 'raf' },
  );
  const elapsed = (await shownAt.jsonValue()) as number;
  const synced = (await (await syncedAt).jsonValue()) as number;
  console.info(
    `TC-21 ${PERSIST_TESTED_NOTES} notes: synced ${Math.round(synced)} ms, all rendered ${Math.round(elapsed)} ms after navigation start (budget ${BOARD_LOAD_BUDGET_MS} ms)`,
  );
  await expect(noteLocator(page)).toHaveCount(PERSIST_TESTED_NOTES);
  expect(elapsed).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);
  await context.close();
});
