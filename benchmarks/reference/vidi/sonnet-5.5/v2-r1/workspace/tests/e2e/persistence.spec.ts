import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { largeBoard } from '../fixtures/boards';
import { setCamera } from './helpers/board';
import { dragNote, newNoteAt, noteViews, notes } from './helpers/participants';
import { WranglerProcess } from './helpers/wrangler-process';

interface Person {
  context: BrowserContext;
  page: Page;
}

async function openPerson(browser: Browser, server: WranglerProcess, boardId: string): Promise<Person> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: server.url });
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.getByTestId('board-viewport').waitFor();
  await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
  return { context, page };
}

interface Look {
  id: string;
  left: number;
  top: number;
  background: string;
  text: string;
  z: string;
}

async function looks(page: Page): Promise<Look[]> {
  const views = await notes(page).evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      return {
        id: e.dataset.noteId ?? '',
        left: parseFloat(e.style.left),
        top: parseFloat(e.style.top),
        background: e.style.background,
        text: e.querySelector('.sticky-text-inner')?.textContent ?? '',
        z: e.style.zIndex,
      };
    }),
  );
  return views.sort((a, b) => (a.id < b.id ? -1 : 1));
}

const COLOURS = ['Pink', 'Blue', 'Green', 'Orange', 'Violet'];

test.describe('persistence across real process restarts', () => {
  let server: WranglerProcess;
  test.beforeEach(async () => {
    server = new WranglerProcess();
    await server.start();
  });
  test.afterEach(async () => {
    await server.dispose();
  });

  test('TC-19 overnight return: 25 varied notes are identical after a restart', async ({ browser }) => {
    const boardId = newBoardId();
    const author = await openPerson(browser, server, boardId);
    const observer = await openPerson(browser, server, boardId);
    await setCamera(author.page, { x: 0, y: 0, zoom: 0.5 });
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const id = await newNoteAt(author.page, 120 + (i % 5) * 110, 120 + Math.floor(i / 5) * 110);
      ids.push(id);
      await author.page.keyboard.type(i % 2 ? `Idea ${i}\nsecond line` : `Note number ${i}`);
      await author.page.keyboard.press('Escape');
      if (i % 5 === 0) await author.page.getByRole('button', { name: `${COLOURS[(i / 5) % COLOURS.length]} colour` }).click();
    }
    // Overlap a few notes so stacking order matters.
    await dragNote(author.page, ids[0], 60, 40);
    await dragNote(author.page, ids[7], -50, 30);
    await dragNote(author.page, ids[12], 40, 40);

    const expected = await looks(author.page);
    expect(expected).toHaveLength(25);
    // Everything has appeared on the other person's screen, therefore it is saved.
    await expect.poll(async () => JSON.stringify(await looks(observer.page)), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(
      JSON.stringify(expected),
    );
    await author.context.close();
    await observer.context.close();

    await server.restart();
    const next = await openPerson(browser, server, boardId);
    await expect.poll(async () => (await looks(next.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(25);
    expect(await looks(next.page)).toEqual(expected);
    await next.context.close();
  });

  test('TC-20 leave immediately: a change another person saw survives exit and restart', async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await openPerson(browser, server, boardId);
    const sam = await openPerson(browser, server, boardId);
    const id = await newNoteAt(alex.page, 400, 300);
    await alex.page.keyboard.type('seen by Sam');
    await expect
      .poll(async () => (await noteViews(sam.page)).some((n) => n.id === id && n.text === 'seen by Sam'), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        intervals: [25, 50, 100],
      })
      .toBe(true);
    const gone = Date.now();
    await Promise.all([alex.context.close(), sam.context.close()]);
    await server.kill();
    console.log(`[persist] closed both people and killed the process ${Date.now() - gone} ms after Sam saw the note`);
    await server.start();
    const back = await openPerson(browser, server, boardId);
    await expect
      .poll(async () => (await noteViews(back.page)).some((n) => n.id === id && n.text === 'seen by Sam'), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(true);
    await back.context.close();
  });

  test('TC-21 big board: all PERSIST_TESTED_NOTES notes render; open time is logged', async ({ browser }) => {
    const boardId = newBoardId();
    const wsUrl = `${server.url.replace('http', 'ws')}/api/rooms`;
    const doc = new Y.Doc();
    initDoc(doc);
    largeBoard(doc);
    expect(snapshot(doc)).toHaveLength(PERSIST_TESTED_NOTES);
    const seeder = new WebsocketProvider(wsUrl, boardId, doc, { WebSocketPolyfill: WebSocket as never, disableBc: true });
    const checkDoc = new Y.Doc();
    const checker = new WebsocketProvider(wsUrl, boardId, checkDoc, { WebSocketPolyfill: WebSocket as never, disableBc: true });
    try {
      await expect
        .poll(() => snapshot(checkDoc).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(PERSIST_TESTED_NOTES); // seen by another connection, therefore stored
    } finally {
      seeder.destroy();
      checker.destroy();
    }
    await server.restart(); // the board must come from storage, not memory

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: server.url });
    const page = await context.newPage();
    const started = Date.now();
    await page.goto(`/b/${boardId}`);
    await expect.poll(() => notes(page).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2, intervals: [50, 100, 250] }).toBe(
      PERSIST_TESTED_NOTES,
    );
    const ms = Date.now() - started;
    console.log(
      `[load] ${PERSIST_TESTED_NOTES} notes rendered ${ms} ms after navigation (budget ${BOARD_LOAD_BUDGET_MS} ms${ms > BOARD_LOAD_BUDGET_MS ? ', OVER' : ''}; reported, not asserted)`,
    );
    await context.close();
  });
});
