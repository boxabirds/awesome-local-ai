// Persistence across real `wrangler dev` restarts (story 4, TC-19 to TC-21).
// Runs in its own Playwright project: every test owns a wrangler process with
// its own --persist-to directory and kills/restarts it.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { largeBoard } from '../fixtures/boards';
import { createByDoubleClick, editor, noteStates, notes, type NoteState } from './helpers/notes';
import { seedBoard, testHook } from './helpers/seed';
import { WranglerProcess } from './helpers/wrangler-process';

const VIEWPORT = { width: 1280, height: 800 };
const PROCESS_TIMEOUT_MS = 240_000;

test.describe.configure({ mode: 'serial', timeout: PROCESS_TIMEOUT_MS });

let server: WranglerProcess;
const contexts: BrowserContext[] = [];

test.beforeEach(async () => {
  server = WranglerProcess.create();
  await server.start();
});

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => {})));
  await server.dispose();
});

async function openBoard(browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT, baseURL: server.url });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => window.__vidi6 !== undefined);
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('connected');
  return page;
}

function byId(list: NoteState[]): NoteState[] {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function closeContext(page: Page): Promise<void> {
  const context = page.context();
  contexts.splice(contexts.indexOf(context), 1);
  await context.close();
}

const COLOURS = ['Orange', 'Green', 'Blue', 'Pink', 'Violet'];

test('TC-19: overnight return — 25 varied notes are identical after everyone leaves and the service restarts', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const page = await openBoard(browser, boardId);
  // Zoom out so a 5×5 grid of notes fits on screen.
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom out' }).click();
  for (let i = 0; i < 25; i++) {
    const at = { x: 300 + (i % 5) * 130, y: 140 + Math.floor(i / 5) * 130 };
    await createByDoubleClick(page, at);
    await page.keyboard.type(i % 4 === 0 ? `Idea ${i}` : `Note ${i}`);
    if (i % 3 === 0) {
      await page.keyboard.press('Enter');
      await page.keyboard.type('second line');
    }
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
    if (i % 2 === 1) await page.getByRole('button', { name: `${COLOURS[i % COLOURS.length]} colour` }).click();
  }
  await expect(notes(page)).toHaveCount(25);
  // Overlap two pairs by dragging (a drag also brings the note to the front).
  for (const [from, to] of [
    [{ x: 300, y: 140 }, { x: 350, y: 170 }],
    [{ x: 560, y: 400 }, { x: 610, y: 440 }],
  ]) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  }
  const before = byId(await noteStates(page));
  expect(before).toHaveLength(25);
  expect(new Set(before.map((n) => n.color)).size).toBeGreaterThan(3);
  expect(before.some((n) => n.text.includes('\n'))).toBe(true);
  // Wait until another person would see the final state, then everyone leaves.
  const observer = await openBoard(browser, boardId);
  await expect.poll(async () => byId(await noteStates(observer)), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual(before);
  await closeContext(page);
  await closeContext(observer);

  await server.restart();

  const back = await openBoard(browser, boardId);
  await expect(notes(back)).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  expect(byId(await noteStates(back))).toEqual(before);
  // Stacking on screen matches too (z-index follows z).
  const screenZ = await back.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]'))
      .sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex))
      .map((el) => el.dataset.noteId),
  );
  const expectedZ = [...before].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1)).map((n) => n.id);
  expect(screenZ).toEqual(expectedZ);
});

test('TC-20: leave immediately — a note Sam saw survives both leaving within 1 s and a crash', async ({ browser }) => {
  const boardId = newBoardId();
  const alex = await openBoard(browser, boardId);
  const sam = await openBoard(browser, boardId);
  const created = await createByDoubleClick(alex, { x: 640, y: 400 });
  const id = await created.getAttribute('data-note-id');
  await alex.keyboard.type('Seen by Sam');
  const onSam = sam.locator(`[data-note-id="${id}"] .sticky-text-content`);
  await expect(onSam).toHaveText('Seen by Sam', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  const seenAt = Date.now();
  await Promise.all([closeContext(alex), closeContext(sam)]);
  await server.kill();
  const elapsed = Date.now() - seenAt;
  console.log(`[persistence] TC-20: contexts closed and process killed ${elapsed} ms after Sam saw the note`);
  expect(elapsed).toBeLessThan(1000);

  await server.start();
  const back = await openBoard(browser, boardId);
  await expect(back.locator(`[data-note-id="${id}"] .sticky-text-content`)).toHaveText('Seen by Sam', {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
});

test('TC-21: big board open — a saved PERSIST_TESTED_NOTES board shows every note (time logged)', async ({ browser }) => {
  const boardId = newBoardId();
  const doc = largeBoard(PERSIST_TESTED_NOTES);
  await seedBoard(server.url, boardId, doc);
  expect(await testHook(server.url, boardId, 'compact')).toEqual({ compacted: true });
  await server.restart(); // cold start: the room loads the snapshot from disk

  const context = await browser.newContext({ viewport: VIEWPORT, baseURL: server.url });
  contexts.push(context);
  const page = await context.newPage();
  const start = Date.now();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-note-id]').length === n,
    PERSIST_TESTED_NOTES,
    { timeout: E2E_EVENTUAL_TIMEOUT_MS, polling: 20 },
  );
  const ms = Date.now() - start;
  const verdict = ms <= BOARD_LOAD_BUDGET_MS ? 'within' : 'OVER';
  console.log(
    `[load time] TC-21: ${PERSIST_TESTED_NOTES} notes rendered ${ms} ms after navigation (${verdict} budget ${BOARD_LOAD_BUDGET_MS} ms; reported, not asserted)`,
  );
  const shown = byId(await noteStates(page));
  expect(shown).toHaveLength(PERSIST_TESTED_NOTES);
  const sample = shown[Math.floor(PERSIST_TESTED_NOTES / 2)];
  await expect(page.locator(`[data-note-id="${sample.id}"] .sticky-text-content`)).toHaveText(sample.text);
});
