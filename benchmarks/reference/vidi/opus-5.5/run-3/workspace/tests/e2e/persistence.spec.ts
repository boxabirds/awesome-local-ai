// persist.room end to end: real `wrangler dev` processes with on-disk state (`--persist-to`) that each test
// kills (SIGKILL) and restarts, so nothing can survive in memory. Runs only in the `persistence` project.
import { expect, test, type Browser, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { WranglerProcess } from './helpers/wrangler-process';
import { setCamera, settle } from './helpers/board';
import { centreOf, dragBy, notes } from './helpers/notes';
import { domSnapshot, waitConnected } from './helpers/participants';
import { createBoardAt } from './helpers/boards-api';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { BOARD_LOAD_BUDGET_MS, PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { largeBoard } from '../fixtures/boards';
import { RETRO_ITEM } from '../fixtures/texts';

// Each worker gets its own port range so tests can run in parallel.
let server: WranglerProcess;
test.beforeEach(async ({}, testInfo) => {
  server = new WranglerProcess(8900 + testInfo.workerIndex * 10);
  await server.start();
});
test.afterEach(async () => {
  await server.dispose();
});

async function openBoardIn(browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${server.baseURL}/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await waitConnected(page);
  return page;
}

/** Everything that must survive, in a stable order: the model (incl. z) and what is drawn (incl. z-index). */
async function boardState(page: Page) {
  const model = [...(await notes(page))].sort((a, b) => (a.id < b.id ? -1 : 1));
  const drawn = await page.locator('[data-note-id]').evaluateAll((els) =>
    els.map((el) => ({ id: (el as HTMLElement).dataset.noteId, z: (el as HTMLElement).style.zIndex })),
  );
  return { model, dom: await domSnapshot(page), drawn };
}

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
// Clear of the notes and of the Share button in the top-right corner (story 5).
const EMPTY_SPOT = { x: 1200, y: 120 };

const TEXTS = Array.from({ length: 25 }, (_, i) =>
  i % 5 === 0 ? RETRO_ITEM : i % 5 === 1 ? `Idea ${i}: shorter standups` : i % 5 === 2 ? `Q${i}? 🎯` : `Note ${i} — keep`,
);

test.describe('Workflow "Overnight return"', () => {
  test('TC-19 25 varied notes are identical after closing the browser and restarting the process', async ({ browser }) => {
    test.setTimeout(180_000);
    const boardId = await createBoardAt(server.baseURL);
    const alex = await openBoardIn(browser, boardId);
    await setCamera(alex, { x: -100, y: 0, zoom: 0.5 });
    await settle(alex);

    for (let i = 0; i < 25; i++) {
      const at = { x: 250 + (i % 5) * 190, y: 110 + Math.floor(i / 5) * 140 };
      await alex.mouse.dblclick(at.x, at.y);
      const editor = alex.getByRole('textbox', { name: 'Note text' });
      await expect(editor).toBeFocused();
      await alex.keyboard.type(TEXTS[i]);
      await alex.keyboard.press('Escape');
      const color = COLORS[i % COLORS.length];
      if (color !== 'yellow') await alex.getByRole('button', { name: `${color[0].toUpperCase()}${color.slice(1)} colour` }).click();
      await alex.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    }
    // Overlap: drag three notes partly onto their neighbours (each comes to the front).
    const byCreation = [...(await notes(alex))].sort((a, b) => a.createdAt - b.createdAt || a.z - b.z);
    for (const i of [6, 12, 18]) {
      await dragBy(alex, await centreOf(alex, byCreation[i].id), 60, 40);
      await alex.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    }
    const before = await boardState(alex);
    expect(before.model).toHaveLength(25);
    expect(new Set(before.model.map((n) => n.color)).size).toBe(COLORS.length);

    // A colleague sees the finished board, so every change is on the server; then everyone leaves.
    const sam = await openBoardIn(browser, boardId);
    await expect.poll(async () => JSON.stringify((await boardState(sam)).model)).toBe(JSON.stringify(before.model));
    await alex.context().close();
    await sam.context().close();

    await server.restart();

    const priya = await openBoardIn(browser, boardId);
    await expect(priya.locator('[data-note-id]')).toHaveCount(25);
    const after = await boardState(priya);
    expect(after.model).toEqual(before.model);
    expect(after.dom).toEqual(before.dom);
    expect(after.drawn).toEqual(before.drawn);
    await priya.context().close();
  });
});

test.describe('Workflow "Leave immediately"', () => {
  test('TC-20 a note Sam has seen survives both leaving and the process being killed at once', async ({ browser }) => {
    test.setTimeout(120_000);
    const boardId = await createBoardAt(server.baseURL);
    const alex = await openBoardIn(browser, boardId);
    const sam = await openBoardIn(browser, boardId);

    await alex.mouse.dblclick(500, 400);
    await expect(alex.getByRole('textbox', { name: 'Note text' })).toBeFocused();
    await alex.keyboard.type('Ship it');
    await expect
      .poll(async () => (await notes(sam)).map((n) => n.text), { intervals: [10] })
      .toEqual(['Ship it']);

    // Within one second of Sam seeing it: both leave and the process dies.
    const seenAt = Date.now();
    await Promise.all([alex.context().close(), sam.context().close(), server.kill()]);
    expect(Date.now() - seenAt).toBeLessThan(1000);

    await server.start();
    const priya = await openBoardIn(browser, boardId);
    await expect(priya.locator('[data-note-id]')).toHaveCount(1);
    expect((await notes(priya)).map((n) => n.text)).toEqual(['Ship it']);
    await priya.context().close();
  });
});

test.describe('Workflow "Big board open"', () => {
  test(`TC-21 a saved ${PERSIST_TESTED_NOTES}-note board shows every note within BOARD_LOAD_BUDGET_MS`, async ({ browser }) => {
    test.setTimeout(180_000);
    const boardId = await createBoardAt(server.baseURL);
    const board = largeBoard();
    const seeded = await fetch(`${server.baseURL}/__test/boards/${boardId}/seed`, {
      method: 'POST',
      body: Buffer.from(Y.encodeStateAsUpdate(board.doc)),
    });
    expect(seeded.status).toBe(200);
    // Load from the saved snapshot, not from a room that still has the board in memory.
    await server.restart();

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${server.baseURL}/b/${boardId}`);
    // Milliseconds from navigation start until the last note element is in the page.
    const elapsed = await page.evaluate(
      (count) =>
        new Promise<number>((resolve) => {
          const check = () => {
            if (document.querySelectorAll('[data-note-id]').length >= count) resolve(performance.now());
            else requestAnimationFrame(check);
          };
          check();
        }),
      PERSIST_TESTED_NOTES,
    );
    console.info(`TC-21 ${PERSIST_TESTED_NOTES} notes rendered ${Math.round(elapsed)} ms after navigation start`);
    expect(elapsed).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);

    // All of them, as saved (zoomed out, every note is actually drawn).
    await setCamera(page, { x: -200, y: -200, zoom: 0.1 });
    await settle(page);
    await expect(page.locator('[data-note-id]')).toHaveCount(PERSIST_TESTED_NOTES);
    const key = (n: StickySnapshot) => `${n.id}|${n.text}|${n.color}|${n.x}|${n.y}|${n.z}`;
    expect((await notes(page)).map(key).sort()).toEqual(snapshot(board.doc).map(key).sort());
    await context.close();
  });
});
