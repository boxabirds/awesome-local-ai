import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import {
  CATCH_UP_TEST_OUTAGE_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';

import {
  LATENCY_BUDGET_MS,
  badgeTexts,
  connectionBadge,
  createNote,
  createNoteAt,
  dragNoteBy,
  dropSockets,
  editorOf,
  expectConnected,
  expectWithin,
  joinBoard,
  noteBox,
  noteIds,
  noteOf,
  noteText,
  notesOnScreen,
  recordBadgeTexts,
  sameNotes,
  setCamera,
  startBoard,
  waitForAgreement,
  waitForNotes,
  watchErrors,
} from './helpers/live';

/**
 * Story 3 — "See other people's edits appear live on the same board".
 *
 * Every test opens the same `/b/<boardId>` in two or more isolated browser
 * contexts (isolated so same-origin tabs cannot sync around the server), edits
 * on one client and asserts the other shows it. A note's on-screen rectangle is
 * the observable: clients that share a camera render a note in the same place,
 * so "identical boards" is a comparison of rectangles.
 */

const VIEWPORT = { width: 1280, height: 800 };

/** Two spots far enough apart that their 200x200 notes never overlap. */
const SPOT_A = { x: 300, y: 260 };
const SPOT_B = { x: 980, y: 260 };

interface Clients {
  pages: Page[];
  boardId: string;
  close(): Promise<void>;
}

/**
 * `count` isolated clients on one fresh board, all in sync. Pull the camera
 * back first with `setCamera` when a test needs more notes than a 100% view
 * holds.
 */
async function openClients(browser: Browser, count: number): Promise<Clients> {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  let boardId = '';
  try {
    for (let seat = 0; seat < count; seat += 1) {
      const context = await browser.newContext({ viewport: VIEWPORT });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      if (seat === 0) boardId = await startBoard(page);
      else await joinBoard(page, boardId);
    }
  } catch (error) {
    await Promise.all(contexts.map((context) => context.close()));
    throw error;
  }
  return {
    pages,
    boardId,
    close: async () => {
      await Promise.all(contexts.map((context) => context.close()));
    },
  };
}

/** Two clients — the shape most of these cases are written with. */
async function twoClients(browser: Browser): Promise<{ a: Page; b: Page; close(): Promise<void> }> {
  const { pages, close } = await openClients(browser, 2);
  return { a: pages[0], b: pages[1], close };
}

/** TC-22: every change type a single writer makes shows up live for the peer. */
test('TC-22: create, move, recolour, text and delete all reach the other client in time', async ({
  browser,
}) => {
  const { a, b, close } = await twoClients(browser);
  try {
    // create — the toolbar is the real user path, and it centres the note.
    const id = await createNote(a);
    await expectWithin(LATENCY_BUDGET_MS, async () => await noteOf(b, id).isVisible());

    // move
    const before = await noteBox(b, id);
    await dragNoteBy(a, id, { x: 120, y: 80 });
    await waitForNotes(b, await notesOnScreen(a));
    const moved = await noteBox(b, id);
    expect(Math.round(moved.x - before.x)).toBe(120);
    expect(Math.round(moved.y - before.y)).toBe(80);

    // recolour
    await noteOf(a, id).click();
    await a.getByTestId('color-pink').click();
    await expectWithin(LATENCY_BUDGET_MS, async () => {
      const colour = await noteOf(b, id).evaluate((element) =>
        getComputedStyle(element).backgroundColor,
      );
      return colour === 'rgb(244, 143, 177)';
    });

    // text
    await typeInNote(a, id, 'hello sam');
    await a.keyboard.press('Escape');
    await expectWithin(LATENCY_BUDGET_MS, async () => (await noteText(b, id)) === 'hello sam');

    // delete
    await noteOf(a, id).click();
    await a.getByTestId('delete-note').click();
    await expectWithin(LATENCY_BUDGET_MS, async () => await noteOf(b, id).isHidden());
  } finally {
    await close();
  }
});

/** TC-23: two people typing into one note at once keep every character. */
test('TC-23: simultaneous typing into the same note merges into identical text', async ({
  browser,
}) => {
  const { a, b, close } = await twoClients(browser);
  try {
    const id = await createNoteAt(a, SPOT_A);
    await waitForNotes(b, await notesOnScreen(a));

    // Both open the editor on that note (editing is local, see TC-28).
    await noteOf(a, id).dblclick();
    await noteOf(b, id).dblclick();
    await expect(editorOf(a)).toBeVisible();
    await expect(editorOf(b)).toBeVisible();

    await Promise.all([
      a.keyboard.type('red', { delay: 25 }),
      b.keyboard.type('blue', { delay: 25 }),
    ]);
    await a.keyboard.press('Escape');
    await b.keyboard.press('Escape');

    const textOnA = await noteText(a, id);
    const textOnB = await noteText(b, id);
    expect(textOnA).toBe(textOnB);
    expect(textOnA).toHaveLength('redblue'.length);
    expect(textOnA.match(/red/g)).toHaveLength(1);
    expect(textOnA.match(/blue/g)).toHaveLength(1);
  } finally {
    await close();
  }
});

/** TC-24: two people dragging the same note still leaves one board. */
test('TC-24: simultaneous drags of the same note settle to one position on both clients', async ({
  browser,
}) => {
  const { a, b, close } = await twoClients(browser);
  try {
    const id = await createNoteAt(a, SPOT_A);
    await waitForNotes(b, await notesOnScreen(a));
    const before = await noteBox(a, id);

    // Neither drag yields: the last write wins, and both clients converge.
    await Promise.all([
      dragNoteBy(a, id, { x: 200, y: 0 }),
      dragNoteBy(b, id, { x: -60, y: 120 }),
    ]);

    await expect
      .poll(async () => sameNotes(await notesOnScreen(a), await notesOnScreen(b)), {
        timeout: 10_000,
        intervals: [10],
      })
      .toBe(true);

    const settled = await noteBox(a, id);
    // A real move, and the very same one on both screens.
    expect(Math.abs(settled.x - before.x) + Math.abs(settled.y - before.y)).toBeGreaterThan(50);
    expect(sameNotes(await notesOnScreen(a), await notesOnScreen(b), 0)).toBe(true);
  } finally {
    await close();
  }
});

/** TC-25: deleting a note out from under an editor leaves no trace and no error. */
test('TC-25: a note deleted elsewhere closes the local editor without errors', async ({
  browser,
}) => {
  const { a, b, close } = await twoClients(browser);
  const errorsOnB = watchErrors(b);
  try {
    const id = await createNoteAt(a, SPOT_A);
    await waitForNotes(b, await notesOnScreen(a));

    // Sam is typing in that note when Alex deletes it.
    await noteOf(b, id).dblclick();
    await expect(editorOf(b)).toBeVisible();
    await b.keyboard.type('half writ');
    await noteOf(a, id).click();
    await a.getByTestId('delete-note').click();

    await expect(noteOf(b, id)).toBeHidden();
    await expect(editorOf(b)).toHaveCount(0);
    // The rest of the board keeps syncing afterwards.
    const other = await createNoteAt(a, SPOT_B);
    await expect(noteOf(b, other)).toBeVisible();
    expect(errorsOnB.errors()).toEqual([]);
  } finally {
    await close();
  }
});

/** TC-26: at full capacity every change of every client reaches every other. */
test('TC-26: five clients each create five notes and move them, and stay identical', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { pages, close } = await openClients(browser, MAX_CONCURRENT_EDITORS);
  try {
    // One camera everywhere so the screens are comparable, pulled back so 25
    // notes fit on a 110px grid without touching (80px wide at this zoom).
    await Promise.all(pages.map((page) => setCamera(page, { x: 0, y: 0, zoom: 0.4 })));

    const GRID = 110;
    const spotFor = (seat: number, index: number): { x: number; y: number } => ({
      x: 190 + index * GRID,
      y: 150 + seat * GRID,
    });
    // Each client moves its own row by the same amount, so notes never collide.
    const deltaFor = (seat: number): { x: number; y: number } => ({ x: 20, y: -14 - seat * 2 });

    const idsBySeat: string[][] = pages.map(() => []);
    let allIds: string[] = [];

    // One round per note: all clients create at the same moment, and the whole
    // board has to agree before the next round starts. A round that converges
    // inside the budget means every change it contained did too.
    for (let index = 0; index < 5; index += 1) {
      const created = await Promise.all(
        pages.map((page, seat) => createNoteAt(page, spotFor(seat, index))),
      );
      created.forEach((id, seat) => idsBySeat[seat].push(id));
      allIds = [...allIds, ...created];
      const elapsed = await waitForAgreement(pages, allIds);
      expect(elapsed).toBeLessThanOrEqual(LATENCY_BUDGET_MS);
    }

    // Then each client moves all five of its notes, one change at a time.
    for (const [seat, ids] of idsBySeat.entries()) {
      for (const id of ids) {
        await dragNoteBy(pages[seat], id, deltaFor(seat));
        const elapsed = await waitForAgreement(pages, allIds);
        expect(elapsed).toBeLessThanOrEqual(LATENCY_BUDGET_MS);
      }
    }

    // Final DOM state: identical rectangles on all five clients.
    const shots = await Promise.all(pages.map(notesOnScreen));
    for (const shot of shots) expect(sameNotes(shots[0], shot, 0)).toBe(true);
    expect(Object.keys(shots[0])).toHaveLength(5 * MAX_CONCURRENT_EDITORS);
  } finally {
    await close();
  }
});

/** TC-27: an outage shows in the badge, and offline work catches up both ways. */
test('TC-27: edits made during a 30-second outage reach the peer after reconnect', async ({
  browser,
}) => {
  test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 120_000);

  const contextA = await browser.newContext({ viewport: VIEWPORT });
  const contextB = await browser.newContext({ viewport: VIEWPORT });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  try {
    const boardId = await startBoard(a);
    await joinBoard(b, boardId);
    // The outage is long, so pull the camera back: three notes per client plus
    // the shared one all fit and never overlap.
    await Promise.all([setCamera(a, { x: 0, y: 0, zoom: 0.4 }), setCamera(b, { x: 0, y: 0, zoom: 0.4 })]);
    const shared = await createNoteAt(a, { x: 1030, y: 700 });
    await waitForNotes(b, await notesOnScreen(a));
    await recordBadgeTexts(a);

    // Alex's Wi-Fi drops. The client notices at once and says so.
    await contextA.setOffline(true);
    await dropSockets(a);
    await expect(connectionBadge(a)).toHaveText('Reconnecting…');

    // Both keep working for the whole outage: Alex adds three notes and moves
    // the shared one, Sam adds three of their own.
    const spots = (row: number) => [1, 2, 3].map((index) => ({ x: 190 + index * 110, y: row }));
    const outage = new Promise((resolve) => setTimeout(resolve, CATCH_UP_TEST_OUTAGE_MS));
    const [offlineIds, onlineIds] = await Promise.all([
      (async () => {
        const ids: string[] = [];
        for (const spot of spots(150)) ids.push(await createNoteAt(a, spot));
        await dragNoteBy(a, shared, { x: 30, y: 30 });
        return ids;
      })(),
      (async () => {
        const ids: string[] = [];
        for (const spot of spots(500)) ids.push(await createNoteAt(b, spot));
        return ids;
      })(),
    ]);
    await outage;
    // None of Alex's work reached Sam while the link was down. (`noteIds` comes
    // back in render order, which is stable rather than chronological.)
    expect((await noteIds(b)).sort()).toEqual([shared, ...onlineIds].sort());

    // Back online: the badge goes Reconnecting → Connected → hidden, and both
    // boards end up with all six notes at the same places.
    await contextA.setOffline(false);
    const everyone = [shared, ...offlineIds, ...onlineIds];
    await waitForAgreement([a, b], everyone, 1.5, 40_000);
    // The badge walked the whole way: Reconnecting → Connected → hidden. (It
    // was hidden before the drop, hence checking the contents rather than the
    // first entry.)
    const shown = await badgeTexts(a);
    expect(shown).toContain('Reconnecting…');
    expect(shown).toContain('Connected');
    await expectConnected(a);
    await expectConnected(b);
    expect((await badgeTexts(a)).at(-1)).toBe('');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

/** TC-28: selection and editing are never broadcast. */
test('TC-28: selecting and editing a note changes nothing on the other client', async ({
  browser,
}) => {
  const { a, b, close } = await twoClients(browser);
  try {
    const id = await createNoteAt(a, SPOT_A);
    await waitForNotes(b, await notesOnScreen(a));

    // Alex selects the note, then starts editing it.
    await noteOf(a, id).click();
    await expect(noteOf(a, id)).toHaveAttribute('data-selected', 'true');
    await noteOf(a, id).dblclick();
    await expect(editorOf(a)).toBeVisible();
    await a.keyboard.type('live draft');

    // The text is content and syncs; Alex's selection outline and open editor
    // are local and never reach Sam's page.
    await expect.poll(() => noteText(b, id)).toBe('live draft');
    await expect(noteOf(b, id)).not.toHaveAttribute('data-selected', 'true');
    await expect(editorOf(b)).toHaveCount(0);
  } finally {
    await close();
  }
});

/** Type into a note; the editor opens on double-click and stays open. */
async function typeInNote(page: Page, id: string, text: string): Promise<void> {
  await noteOf(page, id).dblclick();
  await expect(editorOf(page)).toBeVisible();
  await page.keyboard.type(text);
}
