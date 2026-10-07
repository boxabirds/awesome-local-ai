// Story 8 e2e (wrangler config, chromium): recover my mistakes while
// colleagues work (TC-22 to TC-24). Real browser contexts, real sync, real
// wrangler — each editor's undo/redo only ever touches that editor's own
// LOCAL_ORIGIN steps (undo.own), and a dead step (whose target a colleague
// deleted) is consumed silently without cascading into other steps
// (undo.safe).

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createWranglerProcess, type WranglerProcess } from './wrangler-process';

/** Default e2e camera: screen = world + (640, 400). */
const SX = 640;
const SY = 400;

interface ObjectInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text: string;
  z: number;
}

async function getObjects(page: Page): Promise<Map<string, ObjectInfo>> {
  const list = await page.evaluate(() =>
    (window as unknown as { __vidi6: { getObjects(): ObjectInfo[] } }).__vidi6.getObjects(),
  );
  return new Map(list.map((o) => [o.id, o]));
}

async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-root"]', { timeout: 20000 });
}

/** Create a board through the story 5 API and return its id. */
async function createBoard(base: string): Promise<string> {
  const res = await fetch(`${base}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`board creation failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Create `n` notes at world (x, y) centres via the test hooks; returns ids. */
async function createNotes(
  page: Page,
  seeds: Array<{ x: number; y: number; color: string; text: string }>,
): Promise<string[]> {
  return page.evaluate((list) => {
    const h = (window as unknown as {
      __vidi6: { createNoteAt(x: number, y: number, color: string, text: string): string };
    }).__vidi6;
    return list.map((s) => h.createNoteAt(s.x, s.y, s.color, s.text));
  }, seeds);
}

/** Set persisted width/height on the given notes (raw Y write, origin null). */
async function setSizes(page: Page, ids: string[], sizes: number[]): Promise<void> {
  await page.evaluate(([noteIds, noteSizes]: [string[], number[]]) => {
    const doc = (window as unknown as {
      __vidi6: { doc: { getMap(name: string): { get(id: string): { set(k: string, v: number): void } | undefined } } };
    }).__vidi6.doc;
    const map = doc.getMap('objects');
    noteIds.forEach((id, k) => {
      const obj = map.get(id);
      if (obj) {
        obj.set('width', noteSizes[k]);
        obj.set('height', noteSizes[k]);
      }
    });
  }, [ids, sizes] as [string[], number[]]);
}

/** Wait until every context sees exactly `total` objects. */
async function waitAllSynced(pages: Page[], total: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const sizes = await Promise.all(pages.map(async (p) => (await getObjects(p)).size));
        return sizes.every((n) => n === total);
      },
      { timeout: 20000 },
    )
    .toBe(true);
}

/** Shift + drag from (x1,y1) to (x2,y2) (the marquee). */
async function shiftDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Move the object under the pointer at (x, y) by (dx, dy) screen px. */
async function dragAt(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

interface ConsoleCapture {
  errors: string[];
}

function captureConsole(page: Page): ConsoleCapture {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return { errors };
}

const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo' });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo' });

test.describe('story 8: undo and redo my own changes (wrangler)', () => {
  test('TC-22: recover an accidental delete while a colleague adds a note', async ({ browser }) => {
    const ctxs: BrowserContext[] = [];
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const miaContext = await browser.newContext();
      ctxs.push(miaContext);
      const mia = await miaContext.newPage();
      await openBoard(mia, boardId);

      // Mia seeds eight notes (4 × 2 grid, 220 apart) with distinct colours,
      // texts and sizes; they are her own steps (createNoteAt is a UI action).
      const colors = ['yellow', 'blue', 'green', 'pink'];
      const seeds: Array<{ x: number; y: number; color: string; text: string }> = [];
      for (let row = 0; row < 2; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          seeds.push({
            x: -330 + col * 220,
            y: -50 + row * 100,
            color: colors[(row * 4 + col) % colors.length],
            text: `note ${row * 4 + col}`,
          });
        }
      }
      const ids = await createNotes(mia, seeds);
      const sizes = [220, 230, 240, 250, 260, 270, 280, 290];
      await setSizes(mia, ids, sizes);
      const seedState = new Map((await getObjects(mia)).entries());
      expect(ids).toHaveLength(8);

      const rajContext = await browser.newContext();
      ctxs.push(rajContext);
      const raj = await rajContext.newPage();
      await openBoard(raj, boardId);
      await waitAllSynced([mia, raj], 8);

      // Mia box-selects all eight and deletes them. The marquee uses the
      // fully-inside rule, so it must cover the largest note's full bounds
      // (world -460..475 x, -160..195 y → screen 180..1115 x, 240..595 y);
      // with margin that is screen 140,180 → 1160,640.
      await shiftDrag(mia, 140, 180, 1160, 640);
      await mia.keyboard.press('Delete');
      await expect
        .poll(async () => ((await getObjects(mia)).size, (await getObjects(raj)).size), {
          timeout: 10000,
        })
        .toBe(0);

      // Raj adds his own note while the board is otherwise empty.
      const rajId = await createNotes(raj, [{ x: 700, y: 300, color: 'orange', text: 'rajs note' }]);
      expect(rajId).toHaveLength(1);
      await waitAllSynced([mia, raj], 1);

      // Mia presses Ctrl+Z: her eight notes return on BOTH screens with
      // text, colour, size and position; Raj's note is untouched.
      await mia.keyboard.press('Control+z');
      for (const page of [mia, raj]) {
        await expect
          .poll(async () => (await getObjects(page)).size, { timeout: 10000 })
          .toBe(9);
      }
      for (const id of ids) {
        const seed = seedState.get(id)!;
        for (const page of [mia, raj]) {
          const o = (await getObjects(page)).get(id)!;
          expect(o.text, `text of ${id}`).toBe(seed.text);
          expect(o.color, `colour of ${id}`).toBe(seed.color);
          expect(o.width, `width of ${id}`).toBe(seed.width);
          expect(o.height, `height of ${id}`).toBe(seed.height);
          expect(o.x, `x of ${id}`).toBeCloseTo(seed.x, 3);
          expect(o.y, `y of ${id}`).toBeCloseTo(seed.y, 3);
        }
      }
      expect((await getObjects(mia)).has(rajId[0])).toBe(true);
      expect((await getObjects(raj)).has(rajId[0])).toBe(true);

      // Mia clicks the Redo button: the eight disappear again on both
      // screens; Raj's note remains.
      await redoButton(mia).click();
      for (const page of [mia, raj]) {
        await expect
          .poll(async () => (await getObjects(page)).size, { timeout: 10000 })
          .toBe(1);
        expect((await getObjects(page)).has(rajId[0])).toBe(true);
      }

      // Drain her history: the redo'd delete step is back on top, followed
      // by her eight bounded creations (9 steps); a few extra presses are
      // harmless no-ops. The Undo button ends up disabled.
      for (let i = 0; i < 12; i += 1) {
        await mia.keyboard.press('Control+z');
      }
      for (const page of [mia, raj]) {
        await expect
          .poll(async () => (await getObjects(page)).size, { timeout: 10000 })
          .toBe(1);
      }
      expect(await undoButton(mia).isDisabled()).toBe(true);
      expect(await redoButton(mia).isEnabled()).toBe(true); // the redo stack is full

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-23: a colleague deleted my object — undo is a silent no-op and history keeps working', async ({ browser }) => {
    const ctxs: BrowserContext[] = [];
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const miaContext = await browser.newContext();
      ctxs.push(miaContext);
      const mia = await miaContext.newPage();
      await openBoard(mia, boardId);
      const miaErrors = captureConsole(mia);

      // Mia: create A, move A, create B (three personal steps).
      const aId = (await createNotes(mia, [{ x: 0, y: 0, color: 'yellow', text: 'A' }]))[0];
      // A is centred at world (0,0) = screen (SX, SY).
      await dragAt(mia, SX, SY, 200, 80);
      const bId = (await createNotes(mia, [{ x: 400, y: 200, color: 'green', text: 'B' }]))[0];

      const rajContext = await browser.newContext();
      ctxs.push(rajContext);
      const raj = await rajContext.newPage();
      await openBoard(raj, boardId);
      const rajErrors = captureConsole(raj);
      await waitAllSynced([mia, raj], 2);

      // Raj deletes A (now centred at world (200, 80)).
      await raj.mouse.click(200 + SX, 80 + SY);
      await raj.keyboard.press('Delete');
      await expect
        .poll(async () => (await getObjects(mia)).size, { timeout: 10000 })
        .toBe(1);

      // Mia presses Ctrl+Z: the top of her history is create B (A's move is
      // dead — A is gone). The press must not throw and must undo B only.
      await mia.keyboard.press('Control+z');
      // The deletion of B is Mia's local change; give it time to reach Raj.
      await expect
        .poll(
          async () =>
            Promise.all([mia, raj].map(async (p) => {
              const objects = await getObjects(p);
              return !objects.has(aId) && !objects.has(bId);
            })),
          { timeout: 10000 },
        )
        .toEqual([true, true]); // A stays deleted; B's creation was undone

      // Mia's next undos still work: they consume A's dead steps silently
      // (no errors, A stays absent) and then the history is exhausted.
      await mia.keyboard.press('Control+z');
      await mia.keyboard.press('Control+z');
      await expect
        .poll(
          async () =>
            Promise.all([mia, raj].map(async (p) => {
              const objects = await getObjects(p);
              return objects.size === 0;
            })),
          { timeout: 10000 },
        )
        .toEqual([true, true]);
      expect(await undoButton(mia).isDisabled()).toBe(true);
      expect(miaErrors.errors).toEqual([]);
      expect(rajErrors.errors).toEqual([]);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-24: five editors undo at once — own changes revert, others intact, boards identical', async ({ browser }) => {
    const ctxs: BrowserContext[] = [];
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      // A seeder context creates the fixture (its steps belong to nobody's
      // undo history), then five editor contexts each get one move target
      // and one typing target.
      const seederContext = await browser.newContext();
      ctxs.push(seederContext);
      const seeder = await seederContext.newPage();
      await openBoard(seeder, boardId);

      const cols = [-440, -220, 0, 220, 440];
      const seeds: Array<{ x: number; y: number; color: string; text: string }> = [];
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) seeds.push({ x: cols[i], y: -240, color: 'yellow', text: `move target ${i}` });
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) seeds.push({ x: cols[i], y: -80, color: 'orange', text: `type target ${i}` });
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) seeds.push({ x: cols[i], y: 80, color: 'blue', text: `bystander ${i}` });
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) seeds.push({ x: cols[i], y: 240, color: 'pink', text: `bystander ${i + MAX_CONCURRENT_EDITORS}` });
      const ids = await createNotes(seeder, seeds);
      const seedState = new Map((await getObjects(seeder)).entries());
      expect(ids).toHaveLength(20);
      const moveIds = ids.slice(0, 5);
      const typeIds = ids.slice(5, 10);

      const editors: Array<{ ctx: BrowserContext; page: Page; errors: ConsoleCapture }> = [];
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        const ctx = await browser.newContext();
        ctxs.push(ctx);
        const page = await ctx.newPage();
        await openBoard(page, boardId);
        editors.push({ ctx, page, errors: captureConsole(page) });
      }
      const allPages = [seeder, ...editors.map((e) => e.page)];
      await waitAllSynced(allPages, 20);

      // Everyone moves their move-target (+100, +50)…
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        await dragAt(editors[i].page, cols[i] + SX, -240 + SY, 100, 50);
      }
      // …and types into their type-target. The pause keeps each editor's
      // move and typing more than UNDO_CAPTURE_TIMEOUT_MS apart so they are
      // separate undo steps (the intermediate assertion depends on it).
      await new Promise((r) => setTimeout(r, 700));
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        const page = editors[i].page;
        await page.mouse.dblclick(cols[i] + SX, -80 + SY);
        await page.keyboard.type(' edited');
        await page.keyboard.press('Escape');
      }

      // All contexts see everyone's changes.
      await expect
        .poll(
          async () =>
            Promise.all(
              allPages.map(async (p) => {
                const objects = await getObjects(p);
                const moved = moveIds.every(
                  (id, i) => objects.get(id)!.x === seedState.get(id)!.x + 100,
                );
                const typed = typeIds.every((id, i) => objects.get(id)!.text.endsWith(' edited'));
                return moved && typed;
              }),
            ),
          { timeout: 20000 },
        )
        .toEqual(Array(allPages.length).fill(true));

      // Everyone presses Ctrl+Z once: their own typing is undone; the other
      // four editors' typings are gone too (each owner undid their own), but
      // every move is still in place — no editor undid a colleague's step.
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        await editors[i].page.keyboard.press('Control+z');
      }
      await expect
        .poll(
          async () =>
            Promise.all(
              allPages.map(async (p) => {
                const objects = await getObjects(p);
                const typingsReverted = typeIds.every(
                  (id) => objects.get(id)!.text === seedState.get(id)!.text,
                );
                const movesIntact = moveIds.every(
                  (id) => objects.get(id)!.x === seedState.get(id)!.x + 100,
                );
                return typingsReverted && movesIntact;
              }),
            ),
          { timeout: 20000 },
        )
        .toEqual(Array(allPages.length).fill(true));

      // Everyone presses Ctrl+Z again: their own move is undone. The final
      // board is the seed state on every context — all boards identical.
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        await editors[i].page.keyboard.press('Control+z');
      }
      await expect
        .poll(
          async () =>
            Promise.all(
              allPages.map(async (p) => {
                const objects = await getObjects(p);
                if (objects.size !== 20) return false;
                return [...seedState.values()].every((seed) => {
                  const o = objects.get(seed.id)!;
                  return (
                    o.text === seed.text &&
                    o.color === seed.color &&
                    o.x === seed.x &&
                    o.y === seed.y &&
                    o.width === seed.width &&
                    o.height === seed.height
                  );
                });
              }),
            ),
          { timeout: 20000 },
        )
        .toEqual(Array(allPages.length).fill(true));

      // Byte-for-byte identical boards (same ids, positions, texts, z).
      const snapshots = await Promise.all(
        editors.map(async (e) =>
          [...(await getObjects(e.page)).entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
        ),
      );
      for (let i = 1; i < snapshots.length; i += 1) {
        expect(snapshots[i]).toEqual(snapshots[0]);
      }
      for (const e of editors) expect(e.errors.errors).toEqual([]);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });
});
