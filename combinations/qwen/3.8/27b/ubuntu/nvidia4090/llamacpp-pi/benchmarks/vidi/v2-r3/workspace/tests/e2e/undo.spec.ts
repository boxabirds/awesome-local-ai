import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { apiCreateBoard, openBoard, setCamera, snapshotNotes, type NoteSnapshot } from './helpers';

interface Participant {
  context: BrowserContext;
  page: Page;
}

interface ObjGeom {
  type: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  text: string;
  color: string;
  z: number;
}

interface SeedSpec {
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: string;
  text?: string;
}

/** Read every object's geometry straight from the synced Y.Doc. */
async function readObjects(page: Page): Promise<Record<string, ObjGeom>> {
  return page.evaluate(() => {
    const objects = (window as any).__vidi6.doc.getMap('objects');
    const out: Record<string, ObjGeom> = {};
    objects.forEach((item: any, id: string) => {
      const t = item.get('text');
      out[id] = {
        type: item.get('type'),
        x: item.get('x'),
        y: item.get('y'),
        width: item.get('width') ?? null,
        height: item.get('height') ?? null,
        text: t ? t.toString() : '',
        color: item.get('color'),
        z: item.get('z'),
      };
    });
    return out;
  });
}

/**
 * Seed notes directly into the page's Y.Doc under a NON-local origin, so they
 * appear to every participant but are captured by NO participant's undo
 * history (each tracks only its own LOCAL_ORIGIN transactions). This models a
 * board whose contents pre-date the current session — exactly the situation in
 * which "undo my own changes" must not touch someone else's.
 */
async function seedNotesRemote(page: Page, specs: SeedSpec[]): Promise<string[]> {
  return page.evaluate(
    (specs) => {
      const Y = (window as any).__vidi6.Y;
      const doc = (window as any).__vidi6.doc;
      const objects = doc.getMap('objects');
      let maxZ = 0;
      objects.forEach((item: any) => {
        const z = item.get('z') ?? 0;
        if (z > maxZ) maxZ = z;
      });
      const ids: string[] = [];
      doc.transact(
        () => {
          for (const s of specs) {
            const id = crypto.randomUUID();
            const item = new Y.Map();
            item.set('type', 'sticky');
            item.set('x', s.x);
            item.set('y', s.y);
            if (s.width) item.set('width', s.width);
            if (s.height) item.set('height', s.height);
            item.set('color', s.color ?? 'yellow');
            const t = new Y.Text();
            if (s.text) t.insert(0, s.text);
            item.set('text', t);
            item.set('z', ++maxZ);
            item.set('createdAt', Date.now());
            objects.set(id, item);
            ids.push(id);
          }
        },
        'remote-seed',
      );
      return ids;
    },
    specs,
  );
}

/** Delete one object by id under the page's own LOCAL origin (a real local edit). */
async function deleteObjectById(page: Page, id: string): Promise<void> {
  await page.evaluate((oid) => {
    const objects = (window as any).__vidi6.doc.getMap('objects');
    (window as any).__vidi6.doc.transact(
      () => {
        objects.delete(oid);
      },
      // The board's LOCAL_ORIGIN is a non-serialisable symbol; the undo manager
      // only needs a NON-provider origin, so any local marker works here.
      'local-delete',
    );
  }, id);
}

async function noteCount(page: Page): Promise<number> {
  return page.locator('[data-note-id]').count();
}

async function join(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openBoard(page, boardId);
  return { context, page };
}

async function closeAll(...ps: Participant[]): Promise<void> {
  await Promise.all(
    ps.map(async (p) => {
      await p.page.close().catch(() => undefined);
      await p.context.close().catch(() => undefined);
    }),
  );
}

async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

async function clearSelection(page: Page): Promise<void> {
  await page.mouse.click(100, 770);
}

async function selectedCount(page: Page): Promise<number> {
  return page.locator('[data-selected="true"]').count();
}

async function moveNote(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
}

async function typeInNote(page: Page, sx: number, sy: number, text: string): Promise<void> {
  await page.mouse.dblclick(sx, sy);
  const ta = page.getByLabel('Note text');
  await ta.waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially(text, { delay: 15 });
  await page.keyboard.press('Escape');
}

test.describe('undo (real browsers + wrangler dev)', () => {
  test('TC-22: recover an accidental delete while a colleague adds', async ({ browser, request }) => {
    const board = await apiCreateBoard(request);
    const mia = await join(browser, board);
    const raj = await join(browser, board);
    const page = mia.page;
    const other = raj.page;
    try {
      // 8 cluster notes (marquee-selected) + 4 other notes (far right, outside the
      // marquee), seeded remotely so they pre-date both sessions' undo histories.
      const cluster: SeedSpec[] = [];
      const cols = [-600, -380, -160, 60];
      const rows = [-360, -140];
      let idx = 0;
      for (const y of rows) for (const x of cols) {
        cluster.push({ x, y, width: 200, height: 200, color: ['yellow', 'pink', 'green', 'blue'][idx % 4], text: `c${idx}` });
        idx++;
      }
      // A distinct size on one note to assert size fidelity too.
      cluster[3] = { ...cluster[3], width: 250, height: 250 };
      const others: SeedSpec[] = [0, 1, 2, 3].map((i) => ({ x: 700, y: -360 + i * 220, text: `o${i}` }));

      const seeded = await seedNotesRemote(page, [...cluster, ...others]);
      const clusterIdSet = new Set(seeded.slice(0, 8));
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(12);
      await expect.poll(() => noteCount(other), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(12);
      const before = await readObjects(page);

      // Mia box-selects exactly the 8 cluster notes and deletes them.
      await clearSelection(page);
      await marquee(page, 20, 20, 970, 780);
      await expect.poll(() => selectedCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(8);
      await page.keyboard.press('Delete');
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(4);
      await expect.poll(() => noteCount(other), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(4);

      // Raj adds his own note in empty space (his local action — remote to Mia).
      await typeInNote(other, 1000, 700, 'raj');
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(5);
      const rajId = Object.entries(await readObjects(other)).find(([, g]) => g.text === 'raj')?.[0] ?? '';
      expect(rajId).toBeTruthy();

      // Mia undoes: the 8 notes return on BOTH screens, with their fields.
      await page.keyboard.press('Control+z');
      await expect
        .poll(async () => {
          const o = await readObjects(page);
          const o2 = await readObjects(other);
          return (
            noteCountCheck(o) === 13 &&
            noteCountCheck(o2) === 13 &&
            [...clusterIdSet].every((id) => o[id] && o[id].x === before[id].x && o[id].y === before[id].y)
          );
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);

      // Fidelity: text, colour, size and position all restored.
      const afterUndo = await readObjects(page);
      for (const id of clusterIdSet) {
        expect(afterUndo[id].text).toBe(before[id].text);
        expect(afterUndo[id].color).toBe(before[id].color);
        expect(afterUndo[id].width).toBe(before[id].width);
        expect(afterUndo[id].height).toBe(before[id].height);
      }
      // Raj's note survives Mia's undo (it is not part of her history).
      expect(afterUndo[rajId].text).toBe('raj');

      // Mia's undo history is now exhausted → the Undo button is disabled.
      await expect
        .poll(async () => (await page.getByRole('button', { name: 'Undo' }).isDisabled()), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(true);

      // Mia clicks Redo → the 8 disappear again on both screens.
      await page.getByRole('button', { name: 'Redo' }).click();
      await expect
        .poll(async () => {
          const o = await readObjects(page);
          const o2 = await readObjects(other);
          const gone = [...clusterIdSet].every((id) => !o[id] && !o2[id]);
          return gone && noteCountCheck(o) === 5 && noteCountCheck(o2) === 5;
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
    } finally {
      await closeAll(mia, raj);
    }
  });

  test('TC-23: colleague deleted my object → undo is safe and still works', async ({ browser, request }) => {
    const board = await apiCreateBoard(request);
    const p = await join(browser, board);
    const q = await join(browser, board);
    const page = p.page;
    const other = q.page;
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    try {
      // Two pre-existing notes: P (a survivor) and Q (Mia's object, later deleted).
      const [pId, qId] = await seedNotesRemote(page, [
        { x: -500, y: -200, text: 'P' },
        { x: -100, y: -200, text: 'Q' },
      ]);
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(2);
      await expect.poll(() => noteCount(other), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(2);

      // Mia moves P (step 1) then Q (step 2).
      const before = await readObjects(page);
      await moveNote(page, { x: before[pId].x + 100 + 640, y: before[pId].y + 100 + 400 }, { x: before[pId].x + 100 + 640 + 90, y: before[pId].y + 100 + 400 });
      await moveNote(page, { x: before[qId].x + 100 + 640, y: before[qId].y + 100 + 400 }, { x: before[qId].x + 100 + 640 + 90, y: before[qId].y + 100 + 400 });
      await expect
        .poll(async () => {
          const o = await readObjects(page);
          return o[pId].x === before[pId].x + 90 && o[qId].x === before[qId].x + 90;
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);

      // Raj deletes Q (a real local delete, synced to Mia).
      await deleteObjectById(other, qId);
      await expect
        .poll(async () => {
          const o = await readObjects(page);
          const o2 = await readObjects(other);
          return !o[qId] && !o2[qId];
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);

      // Mia presses Ctrl+Z: undo the (now-unsafe) move of Q → no crash.
      await page.keyboard.press('Control+z');
      // Q is absent on both screens (the undo did not resurrect or corrupt it).
      await expect
        .poll(async () => {
          const o = await readObjects(page);
          const o2 = await readObjects(other);
          return !o[qId] && !o2[qId] && o[pId].x === before[pId].x + 90;
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);

      // Mia's NEXT undo still works: it reverts the safe move of P.
      await page.keyboard.press('Control+z');
      await expect
        .poll(async () => {
          const o = await readObjects(page);
          const o2 = await readObjects(other);
          return o[pId].x === before[pId].x && o2[pId].x === before[pId].x;
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);

      // No crash, no console error.
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await closeAll(p, q);
    }
  });

  test('TC-24: everyone undoing at once', async ({ browser, request }) => {
    const board = await apiCreateBoard(request);
    const ps: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) ps.push(await join(browser, board));
    try {
      // 10 notes: a top row of "move" notes and a bottom row of "type" notes.
      const cols = [-600, -350, -100, 150, 400];
      const specs: SeedSpec[] = [];
      for (const x of cols) specs.push({ x, y: -350, text: `M` });
      for (const x of cols) specs.push({ x, y: -50, text: `T` });
      await seedNotesRemote(ps[0].page, specs);
      for (const p of ps) await expect.poll(() => noteCount(p.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(10);

      const initial = await snapshotNotes(ps[0].page);
      const moveIds = await readIdsAtRow(ps[0].page, -350);
      const typeIds = await readIdsAtRow(ps[0].page, -50);

      // Each editor moves their own note and types in their own note — at once.
      await Promise.all(
        ps.map(async (p, i) => {
          const cx = cols[i] + 100 + 640;
          await moveNote(p.page, { x: cx, y: 150 }, { x: cx + 60 * (i + 1), y: 150 + 20 * (i + 1) });
          await typeInNote(p.page, cx, 450, `hi${i}`);
        }),
      );
      // Everyone converges on the edited board (all 10 moved/typed).
      for (let i = 1; i < ps.length; i++) {
        await expect
          .poll(async () => JSON.stringify(await snapshotNotes(ps[0].page)) === JSON.stringify(await snapshotNotes(ps[i].page)), {
            timeout: E2E_EVENTUAL_TIMEOUT_MS,
          })
          .toBe(true);
      }

      // All press Ctrl+Z twice → each reverts their own two steps.
      await Promise.all(
        ps.map(async (p) => {
          await p.page.keyboard.press('Control+z');
          await p.page.keyboard.press('Control+z');
        }),
      );
      // Every context converges back to the INITIAL board (every change undone).
      for (let i = 1; i < ps.length; i++) {
        await expect
          .poll(async () => JSON.stringify(await snapshotNotes(ps[0].page)) === JSON.stringify(await snapshotNotes(ps[i].page)), {
            timeout: E2E_EVENTUAL_TIMEOUT_MS,
          })
          .toBe(true);
      }
      const final = await snapshotNotes(ps[0].page);
      expect(final).toEqual(initial);
      // Sanity: the specific move/type notes are back where they started.
      const finalObj = await readObjects(ps[0].page);
      expect(moveIds.concat(typeIds).every((id) => finalObj[id])).toBe(true);
      for (const id of typeIds) expect(finalObj[id].text).toBe('T');
    } finally {
      await closeAll(...ps);
    }
  });
});

function noteCountCheck(o: Record<string, ObjGeom>): number {
  return Object.keys(o).length;
}

async function readIdsAtRow(page: Page, worldY: number): Promise<string[]> {
  const o = await readObjects(page);
  return Object.entries(o)
    .filter(([, g]) => Math.abs(g.y - worldY) < 1)
    .map(([id]) => id)
    .sort();
}
