// Story 4 — boards survive everyone leaving and real service restarts (TC-19 to TC-21).
// Each test runs its own `wrangler dev --persist-to <tmp>` and kills/restarts it.
import { type Browser, type Page, expect, test } from '@playwright/test';
import { type StickySnapshot, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import { largeBoard } from '../fixtures/boards';
import { drag, nextFrames, openBoard, setCamera } from './helpers/board';
import { getNotes } from './helpers/participants';
import { seedBoard, storageHook } from './helpers/seed';
import { WranglerProcess } from './helpers/wrangler-process';

test.describe.configure({ mode: 'serial' });

const BASE_PORT = 8790;
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
const TEXTS = [
  'Went well: pairing on the release checklist',
  'Improve: flaky tests\nslow every merge',
  'Action: rotate the on-call buddy',
  'Standups run long',
  'Great customer call with Acme',
];

let server: WranglerProcess;

test.beforeEach(async ({}, testInfo) => {
  test.setTimeout(240_000);
  server = new WranglerProcess(BASE_PORT + testInfo.workerIndex);
  await server.start();
});

test.afterEach(async () => {
  await server.dispose();
});

async function openFresh(browser: Browser, boardId: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await openBoard(page, `${server.baseURL}/b/${boardId}`);
  return { context, page };
}

/** Everything that must survive: text, colour, position and stacking. */
function saved(notes: readonly StickySnapshot[]) {
  return [...notes].sort((a, b) => (a.id < b.id ? -1 : 1)).map(({ id, text, color, x, y, z }) => ({ id, text, color, x, y, z }));
}

async function createNote(page: Page, at: { x: number; y: number }, text: string, color: StickyColor) {
  const before = (await getNotes(page)).length;
  await page.mouse.dblclick(at.x, at.y);
  const editor = page.getByRole('textbox', { name: 'Sticky note text' });
  await expect(editor).toBeFocused();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await getNotes(page)).length).toBe(before + 1);
  if (color !== 'yellow') await page.getByRole('button', { name: `${color[0]!.toUpperCase()}${color.slice(1)} colour` }).click();
  // Click empty space (top right) to clear the selection.
  await page.mouse.click(1240, 60);
  await nextFrames(page);
}

test('TC-19 overnight return: 25 notes are identical after everyone leaves and the service restarts', async ({ browser }) => {
  const boardId = newBoardId();
  const alex = await openFresh(browser, boardId);
  // 50% zoom, world origin at the top left of a 5 × 5 grid.
  await setCamera(alex.page, { x: -200, y: -200, zoom: 0.5 });
  for (let i = 0; i < 25; i++) {
    const at = { x: 160 + (i % 5) * 150, y: 160 + Math.floor(i / 5) * 120 };
    await createNote(alex.page, at, `${TEXTS[i % TEXTS.length]} #${i + 1}`, COLORS[i % COLORS.length]!);
  }
  // Pile a few notes on top of each other (dragging lifts a note to the top).
  for (const [from, dx, dy] of [
    [{ x: 160, y: 160 }, 60, 40],
    [{ x: 460, y: 280 }, -90, -50],
    [{ x: 760, y: 520 }, -70, 30],
  ] as const) {
    await drag(alex.page, from, dx, dy);
  }
  await alex.page.mouse.click(1240, 60);
  const before = saved(await getNotes(alex.page));
  expect(before).toHaveLength(25);
  expect(new Set(before.map((n) => n.color)).size).toBe(COLORS.length);
  expect(before.some((n) => n.text.includes('\n'))).toBe(true);

  await alex.context.close();
  await server.restart();

  const priya = await openFresh(browser, boardId);
  await expect.poll(async () => (await getNotes(priya.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(25);
  expect(saved(await getNotes(priya.page))).toEqual(before);
  await expect(priya.page.getByRole('group', { name: 'Sticky note' })).toHaveCount(25);
  await priya.context.close();
});

test('TC-20 leave immediately: a change another person has seen survives an immediate exit and kill', async ({ browser }) => {
  const boardId = newBoardId();
  const alex = await openFresh(browser, boardId);
  const sam = await openFresh(browser, boardId);
  await alex.page.getByRole('button', { name: 'Sticky note' }).click();
  await alex.page.keyboard.insertText('Seen by Sam');
  const [created] = await getNotes(alex.page);
  expect(created).toBeDefined();
  await expect
    .poll(async () => (await getNotes(sam.page)).find((n) => n.id === created!.id)?.text, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [10],
    })
    .toBe('Seen by Sam');
  const seenAt = Date.now();
  await Promise.all([alex.context.close(), sam.context.close(), server.kill()]);
  const exitMs = Date.now() - seenAt;
  console.log(`[persist] TC-20: contexts closed and service killed ${exitMs} ms after Sam saw the note`);
  expect(exitMs).toBeLessThan(1000);

  await server.start();
  const later = await openFresh(browser, boardId);
  await expect
    .poll(async () => (await getNotes(later.page)).map((n) => [n.id, n.text]), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toEqual([[created!.id, 'Seen by Sam']]);
  await later.context.close();
});

test(`TC-21 big board: a saved ${PERSIST_TESTED_NOTES}-note board opens with every note rendered`, async ({ browser }) => {
  const boardId = newBoardId();
  const doc = largeBoard();
  await seedBoard(server.baseURL, boardId, doc);
  await storageHook(server.baseURL, boardId, 'compact');
  // Open from storage, not from a room that still has the board in memory.
  await server.restart();

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const started = Date.now();
  await page.goto(`${server.baseURL}/b/${boardId}`);
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-sticky-note]').length === n,
    PERSIST_TESTED_NOTES,
    { timeout: E2E_EVENTUAL_TIMEOUT_MS, polling: 20 },
  );
  const elapsed = Date.now() - started;
  const verdict = elapsed <= BOARD_LOAD_BUDGET_MS ? 'within' : 'OVER';
  console.log(
    `[persist] TC-21: ${PERSIST_TESTED_NOTES} notes rendered ${elapsed} ms after navigation (${verdict} the ${BOARD_LOAD_BUDGET_MS} ms budget; reported, not asserted)`,
  );
  await test.info().attach('load-time', { body: `${elapsed} ms (budget ${BOARD_LOAD_BUDGET_MS} ms)`, contentType: 'text/plain' });

  const notes = await getNotes(page);
  expect(notes).toHaveLength(PERSIST_TESTED_NOTES);
  const expected = new Map(snapshot(doc).map((n) => [n.id, n]));
  for (const n of notes) expect(n).toEqual(expected.get(n.id));
  // Zoomed out, the notes are on screen.
  await setCamera(page, { x: -200, y: -200, zoom: 0.1 });
  await expect(page.locator('[data-sticky-note]').first()).toBeVisible();
  await context.close();
});
