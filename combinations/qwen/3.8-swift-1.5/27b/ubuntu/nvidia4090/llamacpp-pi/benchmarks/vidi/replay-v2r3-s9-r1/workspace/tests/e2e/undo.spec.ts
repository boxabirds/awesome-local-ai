import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createBoard } from './helpers/board';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';

/**
 * Story 8 E2E: per-client undo/redo against the live server.
 *
 * TC-22: create 8 notes, delete all, undo → all 8 back, redo → gone again;
 *        a peer's note created on a second context stays intact throughout.
 * TC-23: move a note, a peer deletes it remotely, then undo → no crash and
 *        the note stays deleted (the dangling history entry is inert).
 * TC-24: five contexts each create + move + delete their own two notes and
 *        undo twice → the doc converges to exactly the 10 notes at their
 *        original positions; no 4xx on the wire.
 *
 * Notes are created through the real UI (double-click the board), so the
 * undo history contains genuine LOCAL_ORIGIN steps.
 */

interface NoteState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Read the board's sticky notes from the Y.Doc debug hook. */
async function getNotes(page: Page): Promise<NoteState[]> {
  return page.evaluate(() => {
    const hook = (window as any).__VIDI_DEBUG__;
    if (!hook) throw new Error('Debug hook not available');
    const objects = hook.doc.getMap('objects');
    const notes: NoteState[] = [];
    objects.forEach((obj: any, key: string) => {
      if (obj.get('type') === 'sticky') {
        const w = obj.get('width');
        const h = obj.get('height');
        notes.push({
          // The note id is the Y.Map key (not a stored field).
          id: String(key),
          x: obj.get('x'),
          y: obj.get('y'),
          width: typeof w === 'number' ? w : 200,
          height: typeof h === 'number' ? h : 200,
        });
      }
    });
    return notes;
  });
}

async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => (window as any).__vidi6.setCamera(c), cam);
  await page.waitForFunction(
    (c) => {
      const cur = (window as any).__vidi6.getCamera();
      return cur.x === c.x && cur.y === c.y && cur.zoom === c.zoom;
    },
    cam,
  );
}

/** Open the board in a context and wait for the hooks. */
async function openBoard(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await page.waitForFunction(() => !!(window as any).__VIDI_DEBUG__, undefined, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  return page;
}

async function expectNotes(page: Page, n: number) {
  await expect.poll(async () => (await getNotes(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(n);
}

/**
 * Create a sticky note through the real UI (double-click the board at
 * screen point `at`, viewport-relative) and return the id of the note whose
 * WORLD centre is `worldCenter` — matching by position, because under
 * parallel contexts other clients' notes can sync in between the click and
 * the readback. The note enters text-editing mode on creation, so Escape
 * ends the edit session before returning.
 */
async function createNoteAt(
  page: Page,
  at: { x: number; y: number },
  worldCenter: { x: number; y: number },
): Promise<string> {
  const box = (await page.locator('[data-testid="board-viewport"]').boundingBox())!;
  await page.mouse.dblclick(box.x + at.x, box.y + at.y);
  const handle = await page.waitForFunction(
    (exp: { x: number; y: number }) => {
      const objects = (window as any).__VIDI_DEBUG__.doc.getMap('objects');
      for (const [key, obj] of objects) {
        if (obj.get('type') !== 'sticky') continue;
        // 200×200 stickies: centre = top-left + 100.
        const cx = obj.get('x') + 100;
        const cy = obj.get('y') + 100;
        if (Math.abs(cx - exp.x) < 5 && Math.abs(cy - exp.y) < 5) return String(key);
      }
      return null;
    },
    worldCenter,
    { timeout: E2E_EVENTUAL_TIMEOUT_MS },
  );
  const id = (await handle.jsonValue()) as string;
  await handle.dispose();
  // End the text-editing session the creation opens.
  await page.keyboard.press('Escape');
  return id;
}

/** Mouse-drag the centre of a locator by (dx, dy) screen px. */
async function dragCenter(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!;
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx, sy + dy, { steps: 8 });
  await page.mouse.up();
}

/** Click a note's centre; shift-click when `shift`. */
async function clickNote(page: Page, id: string, shift = false): Promise<void> {
  const box = (await page.locator(`[data-testid="sticky-note-${id}"]`).boundingBox())!;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (shift) await page.keyboard.up('Shift');
}

function expectClose(value: number, target: number, tol: number, label: string) {
  expect(Math.abs(value - target), `${label}: expected ${value} ≈ ${target} (±${tol})`).toBeLessThanOrEqual(tol);
}

test.describe('Story 8: per-client undo/redo (E2E)', () => {
  // TC-22
  test('TC-22: delete 8 notes → undo brings all 8 back → redo deletes them; the peer note is untouched', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await openBoard(ctxA, boardId);
    const b = await openBoard(ctxB, boardId);
    await setCamera(a, { x: 0, y: 0, zoom: 1 });
    await setCamera(b, { x: 0, y: 0, zoom: 1 });

    // A creates 8 notes through the UI (a 4×2 grid) — 8 undo steps.
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const at = { x: 150 + (i % 4) * 200, y: 150 + Math.floor(i / 4) * 250 };
      ids.push(await createNoteAt(a, at, at)); // camera (0,0,1): screen == world
    }
    await expectNotes(a, 8);

    // The peer (B) creates its own note at (700, 650).
    const peerId = await createNoteAt(b, { x: 700, y: 650 }, { x: 700, y: 650 });
    await expect.poll(async () => (await getNotes(a)).some((n) => n.id === peerId), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    }).toBe(true);
    await expectNotes(a, 9);

    // A selects its own 8 notes (NOT the peer's) and deletes the selection.
    await clickNote(a, ids[0]);
    for (let i = 1; i < ids.length; i++) await clickNote(a, ids[i], true);
    expect(await a.getByTestId('selection-count').textContent()).toBe('8 selected');
    await a.keyboard.press('Delete');
    await expectNotes(a, 1);
    expect((await getNotes(a)).some((n) => n.id === peerId), 'peer note survives the delete').toBe(true);

    // Undo → all 8 of A's notes are back (one step for the whole deletion).
    await a.keyboard.press('Control+z');
    await expectNotes(a, 9);
    for (const id of ids) {
      expect((await getNotes(a)).some((n) => n.id === id), `note ${id} restored`).toBe(true);
    }
    expect((await getNotes(a)).some((n) => n.id === peerId), 'peer note still there').toBe(true);

    // Redo → the deletion is re-applied; the peer note is STILL there.
    await a.keyboard.press('Control+Shift+z');
    await expectNotes(a, 1);
    expect((await getNotes(a)).some((n) => n.id === peerId), 'peer note survives the redo').toBe(true);

    await ctxA.close();
    await ctxB.close();
  });

  // TC-23
  test('TC-23: undo after a peer deleted the moved note is a no-op (no crash, note stays gone)', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await openBoard(ctxA, boardId);
    const b = await openBoard(ctxB, boardId);
    await setCamera(a, { x: 0, y: 0, zoom: 1 });
    await setCamera(b, { x: 0, y: 0, zoom: 1 });

    const errors: string[] = [];
    a.on('pageerror', (err) => errors.push(String(err)));

    // A creates a note and moves it (two undo steps).
    const id = await createNoteAt(a, { x: 300, y: 300 }, { x: 300, y: 300 });
    const before = (await getNotes(a)).find((n) => n.id === id)!;
    await dragCenter(a, `[data-testid="sticky-note-${id}"]`, 60, 30);
    const moved = (await getNotes(a)).find((n) => n.id === id)!;
    expectClose(moved.x, before.x + 60, 1, 'moved.x');
    expectClose(moved.y, before.y + 30, 1, 'moved.y');

    // The peer (B) selects the note and deletes it.
    await expect.poll(async () => page0Has(b, id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
    await clickNote(b, id);
    await b.keyboard.press('Delete');

    // A sees the remote deletion.
    await expect.poll(async () => (await getNotes(a)).some((n) => n.id === id), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    }).toBe(false);

    // A undoes: the dangling step is inert — no crash, the note stays deleted.
    await a.keyboard.press('Control+z');
    await expect.poll(async () => (await getNotes(a)).some((n) => n.id === id), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    }).toBe(false);
    expect(errors, `page errors: ${errors.join('; ')}`).toHaveLength(0);

    await ctxA.close();
    await ctxB.close();
  });

  function page0Has(page: Page, id: string): Promise<boolean> {
    return page.evaluate(
      (nid) => {
        const objects = (window as any).__VIDI_DEBUG__.doc.getMap('objects');
        return objects.has(nid);
      },
      id,
    );
  }
});

// TC-24
test.describe('TC-24: five contexts, parallel undo of own create + move + delete', () => {
  test.setTimeout(180000);

  const COUNT = 5;
  const SPACING = 1000;

  /** The world positions each context creates its two notes at. */
  function positionsFor(i: number) {
    return [
      { x: 100 + i * SPACING, y: 100 },
      { x: 100 + i * SPACING, y: 400 },
    ];
  }

  /**
   * One context's workload: create two notes (UI), select both, drag the
   * group, delete the selection, then undo twice (restore delete, restore
   * move). Ends with both notes at their ORIGINAL positions.
   */
  async function workload(page: Page, i: number): Promise<string[]> {
    // Aim the camera at this context's territory (screen x=100 = world x=100+i*SPACING).
    await setCamera(page, { x: i * SPACING, y: 0, zoom: 1 });

    const p0 = positionsFor(i)[0];
    const p1 = positionsFor(i)[1];
    // Camera is at (i*SPACING, 0, 1), so screen x = world x − i*SPACING.
    const id0 = await createNoteAt(page, { x: p0.x - i * SPACING, y: p0.y }, p0);
    const id1 = await createNoteAt(page, { x: p1.x - i * SPACING, y: p1.y }, p1);

    // Select both, drag the group by (50, 30), delete it.
    await clickNote(page, id0);
    await clickNote(page, id1, true);
    await dragCenter(page, `[data-testid="sticky-note-${id0}"]`, 50, 30);
    await page.keyboard.press('Delete');
    // This context's two notes are gone (other contexts' notes may exist).
    await expect
      .poll(
        async () => {
          const ns = await getNotes(page);
          return !ns.some((n) => n.id === id0) && !ns.some((n) => n.id === id1);
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(true);

    // Undo twice: back over the delete, then back over the move.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');

    return [id0, id1];
  }

  test('each context undoes its own create+move+delete; the doc converges to 10 notes at the original positions', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxs = await Promise.all(Array.from({ length: COUNT }, () => browser.newContext()));
    const pages = await Promise.all(ctxs.map((c) => openBoard(c, boardId)));

    const failures: { page: number; url: string; status: number }[] = [];
    pages.forEach((p, i) => {
      p.on('response', (res) => {
        if (res.status() >= 400) failures.push({ page: i, url: res.url(), status: res.status() });
      });
    });

    // All five workloads at once.
    await Promise.all(pages.map((p, i) => workload(p, i)));

    // The canonical final state: exactly the 10 notes at their original
    // (pre-drag) positions, on every page. (The doc stores the note's
    // top-left; positionsFor() gives centres — a 200×200 note's top-left is
    // its centre minus 100.)
    const expected = new Set(
      Array.from({ length: COUNT }, (_, i) => positionsFor(i))
        .flat()
        .map((p) => `${Math.round(p.x - 100)},${Math.round(p.y - 100)}`),
    );
    const canon = (ns: NoteState[]) =>
      JSON.stringify(
        ns
          .map((n) => `${Math.round(n.x)},${Math.round(n.y)}`)
          .sort(),
      );
    const expectedCanon = JSON.stringify([...expected].sort());

    await expect
      .poll(
        async () => {
          const snaps = await Promise.all(pages.map(async (p) => canon(await getNotes(p))));
          return snaps.every((s) => s === expectedCanon) ? 'converged' : 'pending';
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS * 4 },
      )
      .toBe('converged');

    // No 4xx/5xx responses anywhere.
    expect(failures, `HTTP failures: ${JSON.stringify(failures)}`).toHaveLength(0);

    await Promise.all(ctxs.map((c) => c.close()));
  });
});
