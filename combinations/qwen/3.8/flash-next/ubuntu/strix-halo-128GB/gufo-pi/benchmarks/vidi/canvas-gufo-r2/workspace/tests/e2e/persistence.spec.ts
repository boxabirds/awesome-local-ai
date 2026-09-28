/**
 * Story 4 e2e: return to a board and find everything as it was left.
 *
 * These specs drive a private `wrangler dev` with on-disk state
 * (`tests/e2e/helpers/wrangler.ts`), because the scenario is a process dying:
 * the browser closes, the container goes away, and the next visitor must find
 * the board. TC-19, TC-20, TC-21 and TC-24.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { WranglerProcess } from './helpers/wrangler-process';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS } from '../../src/shared/config';

/** Swatch button labels (NoteToolbar capitalises them). */
const SWATCHES = ['Green', 'Pink', 'Blue', 'Orange', 'Violet'];
const WORDS = [
  'shipping',
  'investigated',
  'flaky',
  'pairing',
  'colour',
  'documentation',
  'latency',
  'merged',
  'overlapping',
  'shortcut',
];

let server: WranglerProcess;

// Restarting wrangler dev takes longer than the suite default allows.
test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async () => {
  server = await WranglerProcess.start({ port: 8791 });
});

test.afterAll(async () => {
  if (server) {
    await server.stop();
    server.removePersistDir();
  }
});

/** Open a board without waiting: broken-board tests watch the failure itself. */
async function openBoard(browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${server.baseUrl}/b/${boardId}`);
  return page;
}

async function openConnectedBoard(browser: Browser, boardId: string): Promise<Page> {
  const page = await openBoard(browser, boardId);
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout: 20000 })
    .toBe('connected');
  return page;
}

interface RenderedNote {
  id: string;
  text: string;
  colour: string;
  x: number;
  y: number;
  z: number;
}

function renderedNotes(page: Page): Promise<RenderedNote[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]')).map((el) => {
      const rect = el.getBoundingClientRect();
      const content = el.querySelector('.sticky-text-content');
      return {
        id: el.dataset.noteId as string,
        text: content ? (content.textContent ?? '') : '',
        colour: getComputedStyle(el).backgroundColor,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        z: Number(el.style.zIndex || 0),
      };
    }),
  );
}

async function noteCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-note-id]').length);
}

async function storedNoteCount(boardId: string): Promise<number> {
  return Number((await server.stats(boardId))['notes']);
}

/**
 * Create `count` notes with varied text, colour and position, through the UI.
 * The camera is panned before each creation so every double-click lands on a
 * fresh patch of board; the caller restores the camera afterwards.
 */
async function createNotes(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const column = i % 5;
    const row = Math.floor(i / 5);
    await page.evaluate(
      async ({ x, y }) => {
        window.__vidi6?.setCamera?.({ x, y });
        // Let the new transform paint: a double-click is hit-tested against what
        // is on screen, and notes are DOM elements.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      },
      { x: -column * 500, y: -row * 500 },
    );
    await page.mouse.dblclick(640, 400);
    await page.keyboard.type(`note ${i + 1} ${WORDS[i % WORDS.length]}`);
    await page.keyboard.press('Escape');
    if (i % 3 === 0) {
      const swatch = SWATCHES[(i / 3) % SWATCHES.length];
      await page.getByRole('button', { name: `${swatch} colour` }).click({ timeout: 5000 });
    }
  }
}

/** The camera a freshly opened board starts on, so positions are comparable. */
async function captureHomeCamera(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => ({ ...(window.__vidi6?.getCamera?.() as object) }));
}

async function restoreCamera(page: Page, home: Record<string, number>): Promise<void> {
  await page.evaluate((camera) => window.__vidi6?.setCamera?.(camera), home);
  await page.waitForTimeout(150);
}

test('TC-19: notes with varied text, colour and position survive a process restart', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const page = await openConnectedBoard(browser, boardId);
  const home = await captureHomeCamera(page);

  await createNotes(page, 25);
  await expect
    .poll(() => noteCount(page), { timeout: 10000, message: '25 notes created in the browser' })
    .toBe(25);
  await expect
    .poll(() => storedNoteCount(boardId), { timeout: 15000, message: 'board stored' })
    .toBe(25);

  await restoreCamera(page, home);
  const before = await renderedNotes(page);
  expect(before).toHaveLength(25);
  expect(new Set(before.map((n) => n.id)).size).toBe(25);
  expect(new Set(before.map((n) => n.colour)).size).toBeGreaterThan(1);
  await page.context().close();
  // The board is on disk, not just in this process's memory.
  expect(server.hasPersistedBoardData()).toBe(true);

  await server.restart();

  const reopened = await openConnectedBoard(browser, boardId);
  await expect
    .poll(() => noteCount(reopened), { timeout: 20000, message: 'board rendered again' })
    .toBe(25);
  const after = await renderedNotes(reopened);
  // Same identities, text, colours, positions and stacking order.
  expect(after).toEqual(before);

  // The reopened board still accepts work.
  await reopened.getByRole('button', { name: 'Sticky note' }).click();
  await expect.poll(() => noteCount(reopened)).toBe(26);
  await reopened.context().close();
});

test('TC-20: a note that was on the board for under a second appears on return', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const alex = await openConnectedBoard(browser, boardId);
  const sam = await openConnectedBoard(browser, boardId);

  await alex.mouse.dblclick(420, 300);
  await alex.keyboard.type('left immediately');
  await alex.keyboard.press('Escape');

  // Sam seeing it proves the write completed; both leave straight away.
  await expect.poll(() => noteCount(sam), { timeout: 5000 }).toBe(1);
  const left = await renderedNotes(alex);

  await alex.context().close();
  await sam.context().close();

  await server.restart();

  const back = await openConnectedBoard(browser, boardId);
  await expect
    .poll(() => noteCount(back), { timeout: 20000, message: 'note survived' })
    .toBe(1);
  const returned = await renderedNotes(back);
  expect(returned.map((n) => n.text)).toEqual(left.map((n) => n.text));
  expect(returned.map((n) => n.id)).toEqual(left.map((n) => n.id));
  expect(returned[0].x).toBeCloseTo(left[0].x, 0);
  expect(returned[0].y).toBeCloseTo(left[0].y, 0);
  await back.context().close();
});

test('TC-21: a 2000-note board is fully rendered within the open budget', async ({ browser }) => {
  const boardId = newBoardId();
  await server.hook(boardId, 'seed', { notes: 2000 });
  expect(await storedNoteCount(boardId)).toBe(2000);

  // Timed inside the page: performance.now() is relative to navigation start,
  // so the resolve value covers document load, bundle, sync and rendering.
  const page = await openBoard(browser, boardId);
  const renderedAt = await page.evaluate(async (count) => {
    const deadline = performance.now() + 30000;
    for (;;) {
      const seen = document.querySelectorAll('[data-note-id]').length;
      if (seen >= count) return performance.now();
      if (performance.now() > deadline) throw new Error(`only ${seen} of ${count} notes rendered`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }, 2000);

  console.info(
    `TC-21: 2000 notes rendered in ${renderedAt.toFixed(0)}ms (budget ${BOARD_LOAD_BUDGET_MS}ms)`,
  );
  expect(renderedAt).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout: 10000 })
    .toBe('connected');

  // A second visitor pays the same price, not more: the snapshot is shared.
  const second = await openBoard(browser, boardId);
  const secondAt = await second.evaluate(async (count) => {
    const deadline = performance.now() + 30000;
    for (;;) {
      const seen = document.querySelectorAll('[data-note-id]').length;
      if (seen >= count) return performance.now();
      if (performance.now() > deadline) throw new Error(`only ${seen} of ${count} notes rendered`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }, 2000);
  expect(secondAt).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);

  await page.context().close();
  await second.context().close();
});

test('TC-24: a damaged snapshot shows a red badge, blocks editing, and recovers without reload', async ({
  browser,
}) => {
  const boardId = newBoardId();
  await server.hook(boardId, 'seed', { notes: 25 });
  await server.hook(boardId, 'corrupt-snapshot');
  expect((await server.stats(boardId))['state']).toBe('load-failed');

  const page = await openBoard(browser, boardId);
  const badge = page.getByTestId('connection-status');
  await expect(badge, 'red load-failed badge').toHaveText(
    "This board couldn't be loaded. Retrying…",
    { timeout: 15000 },
  );
  await expect(badge).toHaveCSS('color', 'rgb(185, 28, 28)');
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState))
    .toBe('load_failed');

  // The board stays open but is not editable.
  await expect(page.getByRole('button', { name: 'Sticky note' })).toBeDisabled();
  await page.mouse.dblclick(400, 300);
  await page.keyboard.type('typed on a broken board');
  expect(await noteCount(page)).toBe(0);

  // Repair the storage; the client recovers on its own next attempt.
  await server.hook(boardId, 'repair');
  await expect
    .poll(() => noteCount(page), { timeout: 25000, message: 'board loads after repair' })
    .toBe(25);
  await expect(badge).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState))
    .toBe('connected');

  // Editing is available again: the toolbar creates a note.
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await expect.poll(() => noteCount(page)).toBe(26);
  expect((await server.stats(boardId))['state']).toBe('ready');

  await page.context().close();
});
