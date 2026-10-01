import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS, LOAD_RETRY_MIN_INTERVAL_MS, PERSIST_TESTED_NOTES, STICKY_COLORS,
} from '../../src/shared/config';
import { largeBoard, retroBoard } from '../fixtures/boards';
import { boardSnapshot, closeAll, createNoteAt, expectEventually, notesOf, openParticipants } from './helpers/participants';
import { seedBoard, testHook } from './helpers/seed';
import { WranglerProcess } from './helpers/wrangler-process';

// These tests own the wrangler lifecycle (own port, own --persist-to dir), so run them serially.
test.describe.configure({ mode: 'serial' });

const PORT = 8790;
const server = new WranglerProcess(PORT);
test.use({ baseURL: server.url });

test.beforeAll(async () => { await server.start(); });
test.afterAll(async () => { await server.dispose(); });

const badge = (page: Page) => page.locator('div[role=status]');

/** Notes with their stacking, for comparing a board before and after a restart. */
async function fullSnapshot(page: Page) {
  const notes = await boardSnapshot(page);
  const stacking = await page.locator('[data-note-id]').evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute('data-note-id'), z: (el as HTMLElement).style.zIndex }))
      .sort((a, b) => Number(a.z) - Number(b.z)).map((e) => e.id));
  return { notes, stacking };
}

test.describe('persistence', () => {
  test('TC-19 overnight return: 25 varied notes survive a process restart', async ({ browser }) => {
    test.setTimeout(240_000);
    const boardId = newBoardId();
    const [alex] = await openParticipants(browser, 1, boardId);
    const colours = Object.keys(STICKY_COLORS);
    const colourName = (c: string) => `${c[0].toUpperCase()}${c.slice(1)} colour`;
    for (let i = 0; i < 25; i++) {
      const x = 150 + (i % 7) * 160;
      const y = 150 + Math.floor(i / 7) * 160;
      await createNoteAt(alex.page, x, y);
      await alex.page.keyboard.type(`Note ${i}\nsecond line ${i * 7}`);
      await alex.page.keyboard.press('Escape');
      if (i % 2 === 0) await alex.page.getByRole('button', { name: colourName(colours[i % colours.length]) }).click();
    }
    // Move one note and raise another so positions and stacking are not just defaults.
    const first = notesOf(alex.page).first();
    const box = (await first.boundingBox())!;
    await alex.page.mouse.move(box.x + 20, box.y + 20);
    await alex.page.mouse.down();
    await alex.page.mouse.move(box.x + 60, box.y + 500, { steps: 8 });
    await alex.page.mouse.up();
    await alex.page.mouse.click(1250, 780);
    await expect(notesOf(alex.page)).toHaveCount(25);
    await alex.page.waitForTimeout(1000);
    const before = await fullSnapshot(alex.page);
    await closeAll([alex]);

    await server.stop();
    await server.start();

    const [priya] = await openParticipants(browser, 1, boardId);
    await expect(notesOf(priya.page)).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    expect(await fullSnapshot(priya.page)).toEqual(before);
    await closeAll([priya]);
  });

  test('TC-20 leave immediately: a change another person saw survives instant exit and a kill', async ({ browser }) => {
    test.setTimeout(120_000);
    const boardId = newBoardId();
    const [alex, sam] = await openParticipants(browser, 2, boardId);
    const id = await createNoteAt(alex.page, 400, 300);
    await alex.page.keyboard.type('Seen once');
    await alex.page.keyboard.press('Escape');
    await expectEventually('note text seen by Sam', async () =>
      (await sam.page.locator(`[data-note-id="${id}"]`).textContent())?.includes('Seen once') ?? false);
    await closeAll([alex, sam]);
    await server.stop();
    await server.start();

    const [priya] = await openParticipants(browser, 1, boardId);
    await expect(priya.page.locator(`[data-note-id="${id}"]`)).toContainText('Seen once');
    await closeAll([priya]);
  });

  test('TC-21 big board open: all notes render; time is logged against the budget', async ({ browser }) => {
    test.setTimeout(180_000);
    const boardId = newBoardId();
    await seedBoard(server.url, boardId, largeBoard(PERSIST_TESTED_NOTES));

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const start = Date.now();
    await page.goto(`/b/${boardId}`);
    await expect(page.locator('[data-note-id]')).toHaveCount(PERSIST_TESTED_NOTES, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 });
    const ms = Date.now() - start;
    console.log(`[load] ${PERSIST_TESTED_NOTES} notes rendered in ${ms} ms (${ms > BOARD_LOAD_BUDGET_MS ? 'OVER' : 'within'} budget of ${BOARD_LOAD_BUDGET_MS} ms)`);
    await context.close();
  });

  test('TC-24 broken board: honest failure, no editing, recovery without reload', async ({ browser }) => {
    test.setTimeout(120_000);
    const boardId = newBoardId();
    await seedBoard(server.url, boardId, retroBoard());
    await testHook(server.url, boardId, 'corrupt-snapshot');

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    await expect(badge(page)).toHaveText("This board couldn't be loaded. Retrying…", { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(notesOf(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sticky note' })).toBeDisabled();
    await page.mouse.dblclick(600, 400);
    await page.getByRole('button', { name: 'Sticky note' }).click({ force: true }).catch(() => {});
    await expect(notesOf(page)).toHaveCount(0);

    await testHook(server.url, boardId, 'repair');
    await page.waitForTimeout(LOAD_RETRY_MIN_INTERVAL_MS + 500);
    await expect(notesOf(page)).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 });
    await expect(badge(page)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await expect(notesOf(page)).toHaveCount(26);
    await context.close();
  });
});
