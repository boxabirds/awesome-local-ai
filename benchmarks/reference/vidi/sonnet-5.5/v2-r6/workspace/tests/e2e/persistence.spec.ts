import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { bigBoard } from '../fixtures/boards';
import { setCamera } from './helpers/board';
import { notesOf } from './helpers/participants';
import { seedBoard } from './helpers/seed';
import { WranglerProcess } from './helpers/wrangler-process';

// These tests own their wrangler processes (own ports, own persisted state), separate from the
// shared web server, because they kill and restart the server.
test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName !== 'chromium', 'process-restart tests run in Chromium only');
test.setTimeout(240_000);

let server: WranglerProcess;
test.beforeEach(async ({}, info) => {
  server = new WranglerProcess(8830 + info.parallelIndex);
  await server.start();
});
test.afterEach(async () => { await server.dispose(); });

const COLOURS = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'];

async function waitConnected(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__vidi6?.connectionState), {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  }).toBe('connected');
}

async function open(page: Page, boardId: string) {
  await page.goto(`${server.url}/b/${boardId}`);
  await waitConnected(page);
}

interface View { text: string; left: number; top: number; z: string; bg: string }

/** Everything a person sees about the notes: text, position, colour and stacking, in a stable order. */
async function view(page: Page): Promise<View[]> {
  const notes = await notesOf(page).evaluateAll((els) => els.map((el) => {
    const e = el as HTMLElement;
    return {
      text: (e.querySelector('.sticky-text') as HTMLElement | null)?.textContent ?? '',
      left: parseFloat(e.style.left), top: parseFloat(e.style.top),
      z: e.style.zIndex, bg: getComputedStyle(e).backgroundColor,
    };
  }));
  return notes.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

test('TC-19: overnight return - 25 varied notes are identical after a real process restart', async ({ browser }) => {
  const board = newBoardId();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await open(page, board);
  await setCamera(page, 0, 0, 0.5);
  for (let i = 0; i < 25; i++) {
    await page.mouse.dblclick(120 + (i % 5) * 110, 120 + Math.floor(i / 5) * 110);
    await page.keyboard.type(i % 3 === 0 ? `Idea ${i}\nsecond line` : `Note number ${i}`);
    await page.mouse.click(1200, 760);
    if (i % 2 === 1) {
      await notesOf(page).nth(i).click({ position: { x: 20, y: 20 } });
      await page.getByRole('button', { name: `${COLOURS[i % COLOURS.length]} colour` }).click();
      await page.mouse.click(1200, 760);
    }
  }
  // Move one note on top of another so stacking differs from creation order.
  const from = (await notesOf(page).first().boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 120, from.y + 130, { steps: 6 });
  await page.mouse.up();
  await expect(notesOf(page)).toHaveCount(25);
  const before = await view(page);
  await ctx.close();

  await server.restart();

  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await ctx2.newPage();
  await open(page2, board);
  await expect(notesOf(page2)).toHaveCount(25);
  expect(await view(page2)).toEqual(before);
  await ctx2.close();
});

test('TC-20: leave immediately - a change another person saw survives exit and a hard kill', async ({ browser }) => {
  const board = newBoardId();
  const alexCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const samCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const alex = await alexCtx.newPage();
  const sam = await samCtx.newPage();
  await open(alex, board);
  await open(sam, board);
  await setCamera(alex, 0, 0, 1);
  await setCamera(sam, 0, 0, 1);

  await alex.mouse.dblclick(400, 300);
  await alex.keyboard.type('Seen by Sam');
  await expect.poll(async () => (await view(sam)).map((n) => n.text), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toEqual(['Seen by Sam']);
  const seenAt = Date.now();
  await Promise.all([alexCtx.close(), samCtx.close()]);
  await server.kill();
  console.log(`[persist] change seen -> process killed in ${Date.now() - seenAt} ms`);
  await server.start();

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await open(page, board);
  await expect(notesOf(page)).toHaveCount(1);
  expect((await view(page))[0].text).toBe('Seen by Sam');
  await ctx.close();
});

test('TC-21: big board - all PERSIST_TESTED_NOTES notes open after a restart (time logged, not asserted)', async ({ browser }) => {
  const board = newBoardId();
  const { updates } = bigBoard();
  await seedBoard(server.url, board, updates, PERSIST_TESTED_NOTES);
  await server.restart();

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const startedAt = Date.now();
  await page.goto(`${server.url}/b/${board}`);
  // A cheap DOM count: role-based locators compute accessible names for every note on every poll.
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-sticky-note]').length === n,
    PERSIST_TESTED_NOTES, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2, polling: 50 },
  );
  const ms = Date.now() - startedAt;
  console.log(`[persist] ${PERSIST_TESTED_NOTES} notes rendered ${ms} ms after navigation (budget ${BOARD_LOAD_BUDGET_MS} ms${ms > BOARD_LOAD_BUDGET_MS ? ', OVER' : ''})`);
  await ctx.close();
});
