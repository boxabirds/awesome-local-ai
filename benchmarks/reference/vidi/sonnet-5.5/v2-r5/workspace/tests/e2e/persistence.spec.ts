import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { PERSIST_PORT } from '../../playwright.persistence.config';
import { buildLargeBoard } from '../fixtures/boards';
import { settled } from './helpers/board';
import { notesOf } from './helpers/participants';
import { seedBoard } from './helpers/seed';
import { WranglerProcess } from './helpers/wrangler-process';

test.describe.configure({ mode: 'serial' });

let server: WranglerProcess;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  server = new WranglerProcess(PERSIST_PORT, dir);
  await server.start();
});

test.afterAll(async () => {
  await server.kill();
  rmSync(dir, { recursive: true, force: true });
});

const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };

/** id, position, colour, stacking and text of every note, sorted: the board as a person sees it. */
async function look(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll('[data-sticky]')].map((el) => {
    const e = el as HTMLElement;
    const cs = getComputedStyle(e);
    return [e.dataset.id, e.getAttribute('data-x'), e.getAttribute('data-y'), cs.backgroundColor, cs.zIndex, e.textContent ?? ''].join('|');
  }).sort());
}

async function open(browser: Browser, boardId: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await settled(page);
  return { context, page };
}

async function waitConnected(page: Page): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: /^(Connecting…|Reconnecting…|Connected)$/ }))
    .toHaveCount(0, EVENTUALLY);
}

async function zoomOutTo(page: Page, zoom: number): Promise<void> {
  await page.evaluate((z) => {
    const cam = window.__vidi6!.getCamera();
    window.__vidi6!.setCamera({ ...cam, zoom: z });
  }, zoom);
  await settled(page);
}

test('TC-19 Overnight return: 25 varied notes are identical after a process restart', async ({ browser }) => {
  const boardId = newBoardId();
  const { context, page } = await open(browser, boardId);
  await waitConnected(page);
  await zoomOutTo(page, 0.5);

  for (let i = 0; i < 25; i += 1) {
    await page.mouse.dblclick(150 + (i % 5) * 130, 120 + Math.floor(i / 5) * 130);
    await page.keyboard.type(`Idea ${i}${i % 3 === 0 ? ' with more words to wrap' : ''}`);
    await page.keyboard.press('Escape');
    if (i % 3 === 0) await page.getByRole('button', { name: i % 2 ? 'Pink colour' : 'Blue colour' }).click();
  }
  await page.mouse.click(1150, 700); // deselect
  // Re-stack: drag note 0 over its neighbour (moves it and brings it to the front).
  const first = notesOf(page).first();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(notesOf(page)).toHaveCount(25);

  // Everything has been seen by another person (so it is saved) before everyone leaves.
  const sam = await open(browser, boardId);
  await expect.poll(async () => (await look(sam.page)).length, EVENTUALLY).toBe(25);
  await expect.poll(() => look(sam.page), EVENTUALLY).toEqual(await look(page));
  const expected = await look(page);
  expect(new Set(expected.map((r) => r.split('|')[3])).size).toBeGreaterThan(1); // varied colours
  await context.close();
  await sam.context.close();

  await server.restart();

  const back = await open(browser, boardId);
  await expect(notesOf(back.page)).toHaveCount(25, EVENTUALLY);
  expect(await look(back.page)).toEqual(expected);
  await back.context.close();
});

test('TC-20 Leave immediately: a change another person saw survives exit and restart', async ({ browser }) => {
  const boardId = newBoardId();
  const alex = await open(browser, boardId);
  const sam = await open(browser, boardId);
  await Promise.all([waitConnected(alex.page), waitConnected(sam.page)]);

  await alex.page.mouse.dblclick(400, 300);
  await alex.page.keyboard.type('Seen by Sam');
  await expect.poll(() => notesOf(sam.page).first().textContent(), EVENTUALLY).toBe('Seen by Sam');
  const seenAt = Date.now();
  // Within one second: both leave and the process dies.
  await Promise.all([alex.context.close(), sam.context.close()]);
  await server.kill();
  console.log(`[persistence] left and killed ${Date.now() - seenAt}ms after Sam saw the change`);
  await server.start();

  const back = await open(browser, boardId);
  await expect(notesOf(back.page)).toHaveCount(1, EVENTUALLY);
  await expect(notesOf(back.page).first()).toHaveText('Seen by Sam');
  await back.context.close();
});

test(`TC-21 Big board open: ${PERSIST_TESTED_NOTES} notes all render (time logged against budget)`, async ({ browser }) => {
  const boardId = newBoardId();
  // One update per write: the room compacts several times and a restart loads snapshot + log.
  await seedBoard(server.baseURL, boardId, (doc) => { buildLargeBoard(PERSIST_TESTED_NOTES, doc, { perNote: true }); });
  await server.restart();

  for (const label of ['cold (first open after restart)', 'warm (room already loaded)']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const start = Date.now();
    await page.goto(`/b/${boardId}`);
    await expect(notesOf(page)).toHaveCount(PERSIST_TESTED_NOTES, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 });
    const took = Date.now() - start;
    console.log(
      `[load] ${label}: ${PERSIST_TESTED_NOTES} notes rendered ${took}ms after navigation start `
      + `(${took <= BOARD_LOAD_BUDGET_MS ? 'within' : 'OVER'} ${BOARD_LOAD_BUDGET_MS}ms budget; reported, not asserted)`,
    );
    await context.close();
  }
});
