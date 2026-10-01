import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { largeBoard } from '../fixtures/boards';
import { waitConnected } from './helpers/participants';
import { seedBoard } from './helpers/seed';
import { WranglerProcess } from './helpers/wrangler-process';

// These tests own their own wrangler process (killed and restarted on purpose), on a separate port.
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

// `wrangler dev` proxies a 700 KB sync message to a browser slowly (also true for the story 3 room), so the
// functional wait for the big board is longer than E2E_EVENTUAL_TIMEOUT_MS; the budget itself is only logged.
const BIG_BOARD_FUNCTIONAL_TIMEOUT_MS = 4 * E2E_EVENTUAL_TIMEOUT_MS;
const PORT = 8792;
let dir: string;
let server: WranglerProcess;

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  server = new WranglerProcess(PORT, dir);
  await server.start();
});
test.afterEach(async () => {
  await server.kill();
  rmSync(dir, { recursive: true, force: true });
});

const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });

interface NoteView {
  id: string;
  x: number;
  y: number;
  z: string;
  color: string;
  text: string;
}

async function noteViews(page: Page): Promise<NoteView[]> {
  const views = await notes(page).evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-note-id') ?? '',
      x: Math.round(parseFloat((el as HTMLElement).style.left)),
      y: Math.round(parseFloat((el as HTMLElement).style.top)),
      z: el.getAttribute('data-z') ?? '',
      color: getComputedStyle(el).backgroundColor,
      text: el.querySelector('[data-testid="note-text"]')?.textContent ?? '',
    })),
  );
  return views.sort((a, b) => (a.id < b.id ? -1 : 1));
}

async function open(browser: Browser, boardId: string) {
  const context = await browser.newContext({ baseURL: server.url, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.getByTestId('board-viewport').waitFor();
  await waitConnected(page);
  return { context, page };
}

const COLOURS = ['Orange', 'Green', 'Blue', 'Pink', 'Violet'];

test('TC-19 overnight return: 25 varied notes survive closing everything and restarting the process', async ({ browser }) => {
  const boardId = newBoardId();
  const { context, page } = await open(browser, boardId);
  await page.keyboard.press('Control+Minus');
  await page.keyboard.press('Control+Minus');
  await expect(page.locator('output')).toHaveText('64%'); // 200 px notes become 128 px: the 150 px grid below never overlaps
  for (let i = 0; i < 25; i++) {
    const x = 330 + (i % 5) * 150;
    const y = 110 + Math.floor(i / 5) * 130;
    await page.mouse.dblclick(x, y);
    await expect(notes(page)).toHaveCount(i + 1);
    await page.keyboard.type(`Note ${i}`);
    if (i % 4 === 0) {
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('second line');
    }
    await page.keyboard.press('Escape');
    if (i % 3 !== 0) await page.getByRole('button', { name: `${COLOURS[i % COLOURS.length]} colour` }).click();
    await page.mouse.click(1240, 780); // deselect
  }
  await expect(notes(page)).toHaveCount(25);
  // Re-stack: dragging a note brings it to the front.
  const first = (await notes(page).nth(0).boundingBox())!;
  await page.mouse.move(first.x + 100, first.y + 100);
  await page.mouse.down();
  await page.mouse.move(first.x + 150, first.y + 130, { steps: 5 });
  await page.mouse.up();
  // Let the last changes reach the server before leaving.
  await page.waitForTimeout(500);
  const before = await noteViews(page);
  expect(before).toHaveLength(25);
  await context.close();

  await server.restart();

  const again = await open(browser, boardId);
  await expect(notes(again.page)).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  expect(await noteViews(again.page)).toEqual(before);
  await again.context.close();
});

test('TC-20 leave immediately: a note another person has seen survives an instant exit and restart', async ({ browser }) => {
  const boardId = newBoardId();
  const alex = await open(browser, boardId);
  const sam = await open(browser, boardId);
  await alex.page.mouse.dblclick(500, 400);
  await alex.page.keyboard.type('Seen by Sam');
  await expect.poll(() => notes(sam.page).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
  await expect(notes(sam.page).first()).toContainText('Seen');
  const textOnSam = await notes(sam.page).first().textContent();

  // Sam saw the note appear; within a second everything is gone, including the process.
  await Promise.all([alex.context.close(), sam.context.close(), server.kill()]);
  await server.start();

  const again = await open(browser, boardId);
  await expect(notes(again.page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  expect(await notes(again.page).first().textContent()).toBe(textOnSam);
  await again.context.close();
});

test(`TC-21 big board: all ${PERSIST_TESTED_NOTES} notes render; open time is logged against the budget`, async ({ browser }) => {
  const boardId = newBoardId();
  await seedBoard(server.url, boardId, largeBoard(PERSIST_TESTED_NOTES).doc);
  await server.restart(); // a cold room, as after a real restart

  const context = await browser.newContext({ baseURL: server.url, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const start = Date.now();
  await page.goto(`/b/${boardId}`);
  // Counted in the page: Playwright's role queries over 2000 notes would dominate the measurement.
  await page.waitForFunction((n) => document.querySelectorAll('[data-note-id]').length >= n, PERSIST_TESTED_NOTES, {
    timeout: BIG_BOARD_FUNCTIONAL_TIMEOUT_MS,
    polling: 50,
  });
  const ms = Date.now() - start;
  const flag = ms > BOARD_LOAD_BUDGET_MS ? ' (over budget, not asserted)' : '';
  console.log(`[load] ${PERSIST_TESTED_NOTES} notes rendered in ${ms} ms vs budget ${BOARD_LOAD_BUDGET_MS} ms${flag}`);
  await context.close();
});
