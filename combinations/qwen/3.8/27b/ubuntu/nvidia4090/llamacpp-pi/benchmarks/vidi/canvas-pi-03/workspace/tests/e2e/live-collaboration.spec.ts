import { test, expect } from '@playwright/test';
import {
  newBoardId,
  openBoard,
  closeAll,
  waitForSynced,
  createNoteAt,
  dragNoteBy,
  recolorNote,
  typeInNote,
  deleteNote,
  getNotes,
  getNote,
  noteCenterScreen,
  setCamera,
  getConnectionState,
  dropConnection,
  resumeConnection,
  getBadgeText,
  isSelected,
  notesKey,
  editNote,
  expectWithin,
  LIVE_UPDATE_LATENCY_BUDGET_MS as BUDGET,
  CATCH_UP_TEST_OUTAGE_MS,
  MAX_CONCURRENT_EDITORS,
  type Participant,
} from './participants';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.describe('Live collaboration (chromium, real wrangler dev)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('TC-22: create, move, recolour, type, delete all reach Sam within budget', async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await openBoard(browser, boardId);
    const sam = await openBoard(browser, boardId);
    try {
      // 1. Create.
      const id = await createNoteAt(alex.page, 400, 300);
      await expectWithin(BUDGET, 'create -> sam', async () => (await getNote(sam.page, id)) !== null);

      // 2. Move.
      const beforeMove = (await getNote(alex.page, id))!;
      await dragNoteBy(alex.page, id, 100, 50);
      const moved = await getNote(alex.page, id);
      // The drag actually moved the note (zoom 1: screen px == world units).
      expect(Math.abs(moved!.x - beforeMove.x)).toBeGreaterThan(50);
      expect(Math.abs(moved!.y - beforeMove.y)).toBeGreaterThanOrEqual(40);
      await expectWithin(
        BUDGET,
        'move -> sam',
        async () => {
          const s = await getNote(sam.page, id);
          return !!s && !!moved && Math.abs(s.x - moved.x) < 0.5 && Math.abs(s.y - moved.y) < 0.5;
        },
      );

      // 3. Recolour.
      await recolorNote(alex.page, id, 'blue');
      await expectWithin(BUDGET, 'recolor -> sam', async () => (await getNote(sam.page, id))?.color === 'blue');

      // 4. Type.
      await typeInNote(alex.page, id, 'hello');
      await expectWithin(BUDGET, 'type -> sam', async () => (await getNote(sam.page, id))?.text === 'hello');

      // 5. Delete.
      await deleteNote(alex.page, id);
      await expectWithin(BUDGET, 'delete -> sam', async () => (await getNote(sam.page, id)) === null);
    } finally {
      await closeAll(alex, sam);
    }
  });

  test('TC-23: both type into one note -> identical text with every typed character', async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await openBoard(browser, boardId);
    const sam = await openBoard(browser, boardId);
    try {
      const id = await createNoteAt(alex.page, 400, 300);
      await typeInNote(alex.page, id, 'green');
      await expectWithin(BUDGET * 2, 'base text -> sam', async () => (await getNote(sam.page, id))?.text === 'green');

      // Alex inserts at the start, Sam at the end (concurrent inserts of the same base).
      await editNote(alex.page, id, 'start', 'red ');
      await editNote(sam.page, id, 'end', ' blue');
      // Wait for full convergence.
      await expect
        .poll(
          async () =>
            (await getNote(alex.page, id))?.text === 'red green blue' && (await getNote(sam.page, id))?.text === 'red green blue',
          { timeout: 5000 },
        )
        .toBe(true);

      const a = (await getNote(alex.page, id))!.text;
      const s = (await getNote(sam.page, id))!.text;
      expect(a).toBe(s);
      for (const word of ['red', 'green', 'blue']) expect(a).toContain(word);
    } finally {
      await closeAll(alex, sam);
    }
  });

  test('TC-24: both drag the same note at once -> identical settled position', async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await openBoard(browser, boardId);
    const sam = await openBoard(browser, boardId);
    try {
      const id = await createNoteAt(alex.page, 400, 300);
      await expectWithin(BUDGET * 2, 'note -> sam', async () => (await getNote(sam.page, id)) !== null);

      // Simultaneous drags in different directions; last-write-wins, both converge.
      await Promise.all([dragNoteBy(alex.page, id, 90, 40), dragNoteBy(sam.page, id, -70, 90)]);

      await expect
        .poll(
          async () => {
            const a = await getNote(alex.page, id);
            const s = await getNote(sam.page, id);
            return !!a && !!s && Math.abs(a.x - s.x) < 0.5 && Math.abs(a.y - s.y) < 0.5;
          },
          { timeout: BUDGET * 3 },
        )
        .toBe(true);
    } finally {
      await closeAll(alex, sam);
    }
  });

  test('TC-25: Sam editing, Alex deletes -> note + editor vanish, no errors', async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await openBoard(browser, boardId);
    const sam = await openBoard(browser, boardId);
    const errors: string[] = [];
    sam.page.on('pageerror', (e) => errors.push(String(e)));
    sam.page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    try {
      const id = await createNoteAt(alex.page, 400, 300);
      await expectWithin(BUDGET * 2, 'note -> sam', async () => (await getNote(sam.page, id)) !== null);

      // Sam starts editing the note.
      const sc = await noteCenterScreen(sam.page, (await getNote(sam.page, id))!);
      await sam.page.mouse.dblclick(sc.x, sc.y);
      await expect(sam.page.locator('[data-testid="sticky-textarea"]')).toBeVisible({ timeout: 5000 });

      // Alex deletes it while Sam is editing.
      await deleteNote(alex.page, id);

      // Sam's note and editor disappear.
      await expect
        .poll(async () => (await getNotes(sam.page)).some((n) => n.id === id), { timeout: BUDGET * 2 })
        .toBe(false);
      await expect(sam.page.locator('[data-testid="sticky-textarea"]')).toBeHidden({ timeout: 5000 });

      // No uncaught provider/sync errors on Sam's side.
      expect(errors.filter((e) => /provider|websocket|sync|yjs/i.test(e))).toHaveLength(0);
    } finally {
      await closeAll(alex, sam);
    }
  });

  test('TC-26: full capacity (5 contexts) x create 5 + move 5 -> all converge identically', async ({ browser }) => {
    test.setTimeout(180_000);
    const boardId = newBoardId();
    const parts: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) parts.push(await openBoard(browser, boardId));
    try {
      // Zoom out so 25 notes (100px on screen at 0.5x) fit a non-overlapping
      // 5x5 grid in the 1280x720 viewport; double-clicks must hit empty canvas.
      for (const p of parts) await setCamera(p.page, { x: -640, y: -360, zoom: 0.5 });

      const ids: string[][] = [];
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const arr: string[] = [];
        for (let k = 0; k < 5; k++) {
          arr.push(await createNoteAt(parts[i].page, 100 + i * 230, 80 + k * 130));
        }
        ids.push(arr);
        // Spot-check: participant 0's first note is visible to participant 1 within budget.
        if (i === 0) {
          await expectWithin(BUDGET, 'p0 note -> p1', async () => (await getNote(parts[1].page, arr[0])) !== null);
        }
      }

      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        for (const id of ids[i]) await dragNoteBy(parts[i].page, id, 20 + i * 10, 15);
      }

      await expect
        .poll(
          async () => {
            const keys = new Set<string>();
            for (const p of parts) keys.add(notesKey(await getNotes(p.page)));
            return keys.size === 1;
          },
          { timeout: 30_000 },
        )
        .toBe(true);

      const finalNotes = await getNotes(parts[0].page);
      expect(finalNotes).toHaveLength(25);
      for (const p of parts) expect(notesKey(await getNotes(p.page))).toBe(notesKey(finalNotes));
    } finally {
      await closeAll(...parts);
    }
  });

  test('TC-27: flaky Wi-Fi catch-up (offline outage) -> Reconnecting then Connected, 6 notes', async ({ browser }) => {
    test.setTimeout(120_000);
    const boardId = newBoardId();
    const alex = await openBoard(browser, boardId);
    const sam = await openBoard(browser, boardId);
    try {
      await waitForSynced(alex.page);
      await waitForSynced(sam.page);

      const seen = new Set<string>();
      const record = async () => {
        const t = await getBadgeText(alex.page);
        if (t) seen.add(t);
      };

      // Alex's connection drops (Wi-Fi outage). `setOffline`/`ws.close()` cannot
      // reliably tear down the already-open socket against the local workerd
      // server, so we use the provider's disconnect() via the test hook.
      const t0 = Date.now();
      await dropConnection(alex.page);

      // Badge shows 'Reconnecting…' and the state stays reconnecting.
      await expect.poll(() => getConnectionState(alex.page), { timeout: 10_000 }).toBe('reconnecting');
      await expect.poll(() => getBadgeText(alex.page), { timeout: 10_000 }).toBe('Reconnecting…');
      await record();

      // Both add 3 notes during the outage (Alex's stay local; Sam's sync to the room).
      for (let k = 0; k < 3; k++) {
        await createNoteAt(alex.page, 200 + k * 120, 200);
        await createNoteAt(sam.page, 200 + k * 120, 400);
      }
      await expect
        .poll(async () => (await getNotes(alex.page)).length === 3 && (await getNotes(sam.page)).length === 3, {
          timeout: 10_000,
        })
        .toBe(true);

      // Hold the outage for the configured duration; Alex stays reconnecting and
      // has only his own 3 notes (no catch-up yet).
      const elapsed = Date.now() - t0;
      if (elapsed < CATCH_UP_TEST_OUTAGE_MS) await sleep(CATCH_UP_TEST_OUTAGE_MS - elapsed);
      expect(await getConnectionState(alex.page)).toBe('reconnecting');
      expect((await getNotes(alex.page)).length).toBe(3);

      // The network returns -> Alex reconnects and catches up.
      await resumeConnection(alex.page);
      const tEnd = Date.now() + 20_000;
      while (Date.now() < tEnd) {
        await record();
        const alexNotes = (await getNotes(alex.page)).length;
        if (seen.has('Connected') && alexNotes === 6) break;
        await sleep(50);
      }

      expect(seen.has('Reconnecting…'), `saw Reconnecting (badge=[${[...seen].join(',')}])`).toBe(true);
      expect(seen.has('Connected'), `saw Connected (badge=[${[...seen].join(',')}])`).toBe(true);

      // Both show all 6 notes after catch-up, converged.
      await expect.poll(async () => (await getNotes(alex.page)).length === 6, { timeout: 15_000 }).toBe(true);
      await expect.poll(async () => (await getNotes(sam.page)).length === 6, { timeout: 15_000 }).toBe(true);
      expect(notesKey(await getNotes(alex.page))).toBe(notesKey(await getNotes(sam.page)));
    } finally {
      await closeAll(alex, sam);
    }
  });

  test('TC-28: selection & editor are local (Sam sees no outline or editor)', async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await openBoard(browser, boardId);
    const sam = await openBoard(browser, boardId);
    try {
      const id = await createNoteAt(alex.page, 400, 300);
      await expectWithin(BUDGET * 2, 'note -> sam', async () => (await getNote(sam.page, id)) !== null);

      // Alex selects -> only Alex shows a selection outline.
      const ac = await noteCenterScreen(alex.page, (await getNote(alex.page, id))!);
      await alex.page.mouse.click(ac.x, ac.y);
      await expect(alex.page.locator('[data-testid="note-toolbar"]')).toBeVisible({ timeout: 5000 });
      await expect.poll(() => isSelected(alex.page, id), { timeout: 5000 }).toBe(true);
      expect(await isSelected(sam.page, id)).toBe(false);

      // Alex edits -> only Alex shows a textarea; Sam shows none.
      await alex.page.mouse.dblclick(ac.x, ac.y);
      await expect(alex.page.locator('[data-testid="sticky-textarea"]')).toBeVisible({ timeout: 5000 });
      expect(await sam.page.locator('[data-testid="sticky-textarea"]').count()).toBe(0);
    } finally {
      await closeAll(alex, sam);
    }
  });
});
