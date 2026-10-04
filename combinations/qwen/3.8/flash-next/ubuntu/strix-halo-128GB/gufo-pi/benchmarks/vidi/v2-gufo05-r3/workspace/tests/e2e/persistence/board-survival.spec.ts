/**
 * Boards that outlive the process that held them (story 4, task 6): TC-19, TC-20,
 * TC-21. Runs in the `persistence` Playwright project, whose dev server this spec
 * owns: it is started here, stopped mid-test and started again over the same
 * storage directory. That stop is the test — nothing else available can make the
 * server forget a board while the board itself remains.
 */
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

import { snapshot } from '../../../src/shared/board-model';
import {
  BOARD_LOAD_BUDGET_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../../src/shared/config';
import { encodeBoard, largeBoard } from '../../fixtures/boards';
import {
  boardKey,
  boardOf,
  closeParticipants,
  expectEventually,
  freshBoardId,
  openParticipant,
  openParticipants,
} from '../helpers/participants';
import {
  createStickyByButton,
  getBoard,
  notes,
  stopEditing,
} from '../helpers/sticky-notes';
import { setCamera } from '../helpers/board';
import {
  PERSISTENCE_INSPECTOR_PORT,
  PERSISTENCE_PORT,
  startWrangler,
  type WranglerServer,
} from '../helpers/wrangler-process';
import { timeBoardHandover } from '../helpers/room-probe';

const ZOOM = 1;
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
/** Notes are 200 board units wide; this leaves clear air between neighbours. */
const GRID_STEP = 300;
const GRID_COLUMNS = 5;
/** Text of varied length, so at least one note has to shrink its font. */
const PHRASES = [
  'Buy more violet sticky notes',
  'The import script needs a dry-run mode before anyone runs it on real data',
  'Who owns the onboarding docs? Nobody answered in Thursday’s meeting, so I am writing it here where it cannot be skipped past',
  'Ship the retry fix',
  'Ask Sam about the storage numbers',
];

let server: WranglerServer;

test.beforeAll(async () => {
  server = await startWrangler({
    port: PERSISTENCE_PORT,
    inspectorPort: PERSISTENCE_INSPECTOR_PORT,
    testHooks: '1',
  });
});

test.afterAll(async () => {
  await server.dispose();
});

/** Put the viewport centre on a world point, so the next note lands there. */
async function aimAt(page: Page, index: number): Promise<void> {
  const column = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  await setCamera(page, {
    x: column * GRID_STEP - 640 / ZOOM,
    y: row * GRID_STEP - 400 / ZOOM,
    zoom: ZOOM,
  });
}

/**
 * Build a 25-note board the way a person does: the toolbar button, the keyboard,
 * a colour from the note toolbar. Nothing is injected, so what the browser sends
 * is what the room has to keep.
 */
async function buildBoardByHand(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await aimAt(page, i);
    await createStickyByButton(page);
    await page.keyboard.type(PHRASES[i % PHRASES.length]);
    await stopEditing(page);
    const color = COLORS[i % COLORS.length];
    await page.getByRole('button', { name: `${color} colour` }).click();
  }
  await expect(notes(page)).toHaveCount(count);
}

/** Call one of the worker's board test hooks. */
async function callHook(
  request: APIRequestContext,
  boardId: string,
  hook: 'seed' | 'compact' | 'corrupt-snapshot' | 'repair',
  body?: Uint8Array,
): Promise<Record<string, unknown>> {
  const response = await request.post(`/__test/boards/${boardId}/${hook}`, {
    // A Buffer is sent as-is; a Uint8Array would be treated as an object and
    // JSON-stringified into garbage the room cannot decode.
    data: Buffer.from(body ?? new Uint8Array(0)),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  expect(payload, `${hook} responded: ${JSON.stringify(payload)}`).toMatchObject({ ok: true });
  return payload;
}

test.describe('overnight return (TC-19)', () => {
  test.setTimeout(240_000);

  test('a board comes back exactly as it was left, after the server forgets it', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const alex = await openParticipant(browser, 'Alex', boardId);
    await buildBoardByHand(alex.page, 25);

    const left = await boardOf(alex);
    expect(left).toHaveLength(25);
    // Real variety, or the comparison below would be comparing nothing.
    expect(new Set(left.map((note) => note.text)).size).toBeGreaterThan(3);
    expect(new Set(left.map((note) => note.color)).size).toBe(COLORS.length);
    expect(new Set(left.map((note) => `${note.x},${note.y}`)).size).toBe(25);
    expect(alex.consoleErrors).toEqual([]);

    // The person closes the tab. Later, the server goes away and comes back: the
    // room is constructed from nothing but its storage.
    await closeParticipants([alex]);
    await server.restart();

    const back = await openParticipant(browser, 'Alex', boardId);
    await expectEventually(
      'TC-19 board loaded from storage',
      () => boardOf(back),
      (board) => board.length === 25,
    );
    const returned = await boardOf(back);
    // Same text, colour, position and stacking order, note for note.
    expect(boardKey(returned)).toBe(boardKey(left));
    expect(back.consoleErrors).toEqual([]);
    await closeParticipants([back]);
  });
});

test.describe('leave immediately (TC-20)', () => {
  test.setTimeout(180_000);

  test('a note both editors have seen survives an abrupt stop one second later', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const [alex, sam] = await openParticipants(browser, boardId, ['Alex', 'Sam']);
    await aimAt(alex.page, 0);
    await createStickyByButton(alex.page);
    await alex.page.keyboard.type('written once, kept twice');
    await stopEditing(alex.page);

    await expectEventually(
      'TC-20 note visible to Sam',
      () => boardOf(sam),
      (board) => board.length === 1,
    );
    const seenAt = Date.now();

    // Both tabs close and the process is killed within a second of that sighting.
    // The room wrote the change before it handed it to Sam, so the note is there.
    await closeParticipants([alex, sam]);
    await server.stop('SIGKILL');
    expect(Date.now() - seenAt, 'both tabs gone and the process killed within 1s').toBeLessThan(
      1_000,
    );

    await server.restart();
    const back = await openParticipant(browser, 'Alex', boardId);
    const board = await boardOf(back);
    expect(board.map((note) => note.text)).toEqual(['written once, kept twice']);
    await closeParticipants([back]);
  });
});

test.describe('big board open (TC-21)', () => {
  test.setTimeout(600_000);

  test(`a ${PERSIST_TESTED_NOTES}-note board opens completely`, async ({ browser, request }) => {
    const boardId = freshBoardId();
    const fixture = largeBoard();
    const expected = snapshot(fixture.doc);
    expect(expected).toHaveLength(PERSIST_TESTED_NOTES);

    // Seeded through the room's own storage path, so the tab below opens a board
    // that was already saved, not a document it is being handed.
    const seeded = await callHook(request, boardId, 'seed', encodeBoard(fixture.doc));
    expect(seeded.notes).toBe(PERSIST_TESTED_NOTES);

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const opened = Date.now();
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-board-surface]');
    try {
      // Two moments worth separating: the tab holding all 2000 notes (that is the
      // room reading its storage and the sync delivering them) and the tab showing
      // all 2000 notes (that is the browser building 2000 positioned, measured
      // elements). The budget is about the first; a person notices the second.
      await page.waitForFunction(
        (count: number) => (window as any).__vidi6?.getBoard?.().length >= count,
        PERSIST_TESTED_NOTES,
        { timeout: 300_000 },
      );
      // What the room itself costs, measured without a browser in the way: the tab
      // above cannot be polled while it is busy building 2000 elements, so any
      // figure taken from inside it is really a rendering figure.
      const handover = await timeBoardHandover(server.url, boardId, PERSIST_TESTED_NOTES);
      const loadedMs = Date.now() - opened;
      await page.waitForFunction(
        (count: number) => document.querySelectorAll('[data-sticky-note]').length >= count,
        PERSIST_TESTED_NOTES,
        { timeout: 300_000 },
      );
      const renderedMs = Date.now() - opened;
      // Reported, never asserted as a pass or fail: model, browsers and server all
      // share this machine, so the numbers move with whatever else is running.
      console.log(
        `TC-21 ${PERSIST_TESTED_NOTES} notes — room to a joining client: ${handover.ms} ms; ` +
          `in the tab: ${loadedMs} ms; all on screen: ${renderedMs} ms ` +
          `(BOARD_LOAD_BUDGET_MS = ${BOARD_LOAD_BUDGET_MS}, reported against the room ` +
          `measurement, never asserted)`,
      );

      const board = await getBoard(page);
      expect(board).toHaveLength(PERSIST_TESTED_NOTES);
      expect(boardKey(board)).toBe(boardKey(expected));
    } finally {
      await context.close();
    }
  });
});
