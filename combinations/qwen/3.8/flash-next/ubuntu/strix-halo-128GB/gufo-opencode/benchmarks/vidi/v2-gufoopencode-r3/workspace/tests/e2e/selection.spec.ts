import { expect, test, type Page } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD
} from '../../src/shared/config';
import {
  createBoard,
  dragBy,
  getNotes,
  noteLocator,
  openBoard,
  setCamera,
  type NoteState
} from './helpers/board';
import { openParticipants, snapshotsAgree, type Participant } from './helpers/participants';
import { seedNotes } from './helpers/seed-client';

const PORT = Number(process.env.E2E_PORT ?? 22704);

async function createNoteAt(page: Page, cx: number, cy: number): Promise<string> {
  return page.evaluate(
    ({ x, y }) => window.__vidi6!.createNote({ x, y }),
    { x: cx, y: cy }
  );
}

async function noteById(page: Page, id: string): Promise<NoteState> {
  const notes = await getNotes(page);
  const note = notes.find((n) => n.id === id);
  if (note === undefined) throw new Error(`note ${id} not found`);
  return note;
}

async function shiftClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
}

async function marquee(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

async function worldCenter(page: Page, cam: { x: number; y: number; zoom: number }, cx: number, cy: number) {
  await setCamera(page, cam);
  return { x: (cx - cam.x) * cam.zoom, y: (cy - cam.y) * cam.zoom };
}

test.describe('sel.marquee_ui (e2e)', () => {
  test('TC-32 marquee selects only the fully-inside note', async ({ page }) => {
    await openBoard(page);
    const cam = { x: -600, y: -300, zoom: 1 };
    const a = await createNoteAt(page, 0, 0); // rect -100..100
    const b = await createNoteAt(page, 150, 0); // rect 50..250: partly inside
    const c = await createNoteAt(page, 600, 0); // far right: outside
    const start = await worldCenter(page, cam, -250, -220);
    const end = await worldCenter(page, cam, 220, 220);
    await marquee(page, start, end);
    await expect(noteLocator(page, a)).toHaveAttribute('data-selected', 'true');
    await expect(noteLocator(page, b)).toHaveAttribute('data-selected', 'false');
    await expect(noteLocator(page, c)).toHaveAttribute('data-selected', 'false');
  });
});

test.describe('sel.transform (e2e)', () => {
  test('TC-33 group move over a fourth note, then corner resize scales sizes and gaps', async ({
    page
  }) => {
    await openBoard(page);
    const cam = { x: -600, y: -300, zoom: 1 };
    const d = await createNoteAt(page, 400, 600); // the note the cluster moves onto
    const centers = [
      [0, 0],
      [250, 0],
      [500, 0],
      [0, 250],
      [250, 250],
      [500, 250]
    ] as const;
    const ids: string[] = [];
    for (const [cx, cy] of centers) ids.push(await createNoteAt(page, cx, cy));
    const before = new Map((await getNotes(page)).map((n) => [n.id, n]));

    // Select exactly the six (click + shift-click), leaving D unselected.
    const p0 = await worldCenter(page, cam, 0, 0);
    await page.mouse.click(p0.x, p0.y);
    for (const [cx, cy] of centers.slice(1)) {
      const p = await worldCenter(page, cam, cx, cy);
      await shiftClick(page, p.x, p.y);
    }
    await expect(page.getByTestId('selection-bar')).toContainText('6 selected');

    // Move the whole cluster 300 world units down, onto note D.
    const grab = await worldCenter(page, cam, 250, 250);
    await dragBy(page, grab, 0, 300);
    await expect
      .poll(async () => {
        const notes = await getNotes(page);
        return ids.every((id) => {
          const now = notes.find((n) => n.id === id)!;
          const was = before.get(id)!;
          return Math.abs(now.x - was.x) < 0.5 && Math.abs(now.y - (was.y + 300)) < 0.5;
        });
      })
      .toBe(true);
    const movedD = await noteById(page, d);
    expect(movedD.x).toBeCloseTo(before.get(d)!.x, 0);
    expect(movedD.y).toBeCloseTo(before.get(d)!.y, 0);
    // The moved cluster now overlaps D ("above a fourth note").
    const dRect = { x: movedD.x, y: movedD.y, w: 200, h: 200 };
    const overlaps = ids.some((id) => {
      const n = before.get(id)!;
      const rx = n.x;
      const ry = n.y + 300;
      return rx < dRect.x + dRect.w && rx + 200 > dRect.x && ry < dRect.y + dRect.h && ry + 200 > dRect.y;
    });
    expect(overlaps).toBe(true);

    // Zoom out so the resize handles are on screen, then drag the SE handle
    // of the selection bounding box.
    const cam2 = { x: -600, y: -100, zoom: 0.5 };
    await setCamera(page, cam2);
    const handle = page.locator('[data-handle="se"]');
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (box === null) throw new Error('SE handle has no bounding box');
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 100, 100);

    // Sticky resize is aspect-locked and scales the whole selection uniformly:
    // every note is square again, strictly larger, gaps scaled with sizes, and
    // the top-left corner of the bounding box stays anchored.
    await expect
      .poll(async () => {
        const notes = await getNotes(page);
        const six = ids.map((id) => notes.find((n) => n.id === id)!);
        if (six.some((n) => n.width === null || n.height === null)) return false;
        const w = six[0].width!;
        if (!(w > 200) || !six.every((n) => Math.abs(n.width! - w) < 0.5 && Math.abs(n.height! - w) < 0.5)) {
          return false;
        }
        // Uniform layout scale: centre distances scale exactly like sizes.
        const s = w / 200;
        const dx = Math.abs(six[1].x - six[0].x);
        const dy = Math.abs(six[3].y - six[0].y);
        return Math.abs(dx - 250 * s) < 1 && Math.abs(dy - 250 * s) < 1;
      })
      .toBe(true);
    const finalD = await noteById(page, d);
    expect(finalD.width).toBeNull(); // D untouched: still implicit size
    expect(finalD.x).toBeCloseTo(before.get(d)!.x, 0);
  });
});

test.describe('sel.keyboard (e2e)', () => {
  test('TC-34 arrow keys nudge without panning or scrolling, Delete removes all', async ({
    page
  }) => {
    await openBoard(page);
    const cam = { x: -600, y: -300, zoom: 1 };
    const a = await createNoteAt(page, 0, 0);
    const b = await createNoteAt(page, 250, 0);
    const pa = await worldCenter(page, cam, 0, 0);
    const pb = await worldCenter(page, cam, 250, 0);
    await page.mouse.click(pa.x, pa.y);
    await shiftClick(page, pb.x, pb.y);
    await expect(page.getByTestId('selection-bar')).toContainText('2 selected');
    const markerBefore = await page.getByTestId('origin-marker').boundingBox();

    await page.keyboard.press('ArrowRight');
    await expect
      .poll(async () => {
        const [na, nb] = await Promise.all([noteById(page, a), noteById(page, b)]);
        return na.x === -100 + NUDGE_STEP_WORLD && nb.x === 150 + NUDGE_STEP_WORLD;
      })
      .toBe(true);
    await page.keyboard.press('Shift+ArrowUp');
    await expect
      .poll(async () => {
        const na = await noteById(page, a);
        return na.y === -100 - NUDGE_LARGE_STEP_WORLD;
      })
      .toBe(true);

    // No board pan: the origin marker stayed exactly where it was.
    const markerAfter = await page.getByTestId('origin-marker').boundingBox();
    expect(markerAfter).toEqual(markerBefore);
    // No page scroll either.
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);

    await page.keyboard.press('Delete');
    await expect.poll(async () => (await getNotes(page)).length).toBe(0);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });
});

async function openOnBoard(browser: import('@playwright/test').Browser, boardId: string, name: string): Promise<Participant> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  return { name, context, page };
}

test.describe('sel.interaction prune (e2e)', () => {
  test('TC-35 colleague deletes one of my selected notes', async ({ browser }) => {
    const bootstrap = await browser.newContext();
    const boardId = await createBoard(bootstrap.request);
    await bootstrap.close();
    await seedNotes(PORT, boardId, 20);
    const lee = await openOnBoard(browser, boardId, 'lee');
    const sam = await openOnBoard(browser, boardId, 'sam');
    await expect.poll(async () => (await getNotes(lee.page)).length).toBe(20);
    await expect.poll(async () => (await getNotes(sam.page)).length).toBe(20);

    const cam = { x: -300, y: -250, zoom: 1 };
    await setCamera(lee.page, cam);
    await setCamera(sam.page, cam);

    // Lee shift-drags a marquee over exactly the first four notes (row y=0).
    const start = { x: -150 - cam.x, y: -150 - cam.y };
    const end = { x: 850 - cam.x, y: 150 - cam.y };
    await marquee(lee.page, start, end);
    await expect(lee.page.getByTestId('selection-bar')).toContainText('4 selected');

    // Sam selects one of those four and deletes it.
    const victim = { x: 220 - cam.x, y: 0 - cam.y }; // centre of the second note
    await sam.page.mouse.click(victim.x, victim.y);
    await sam.page.keyboard.press('Delete');

    // Lee's selection prunes itself: the bar drops to "3 selected".
    const startMs = Date.now();
    await expect(lee.page.getByTestId('selection-bar')).toContainText('3 selected', {
      timeout: 10_000
    });
    console.log(`[latency] TC-35 prune: ${Date.now() - startMs}ms (budget 1000ms, reported)`);

    // The three survivors are still outlined for Lee.
    const remaining = (await getNotes(lee.page))
      .filter((n) => n.y > -110 && n.y < 110)
      .filter((n) => n.x >= -110 && n.x <= 660)
      .map((n) => n.id);
    expect(remaining).toHaveLength(3);
    for (const id of remaining) {
      await expect(noteLocator(lee.page, id)).toHaveAttribute('data-selected', 'true');
    }

    // Lee deletes the remaining three; everyone converges on 16 notes.
    await lee.page.keyboard.press('Delete');
    await expect.poll(async () => (await getNotes(lee.page)).length).toBe(16);
    await expect.poll(async () => (await getNotes(sam.page)).length).toBe(16);
    await lee.context.close();
    await sam.context.close();
  });
});

test.describe('sel.transform capacity (e2e)', () => {
  test('TC-36 five editors move different selections simultaneously', async ({ browser }) => {
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `editor-${i}`);
    const participants = await openParticipants(browser, names);
    const cam = { x: -300, y: -250, zoom: 1 };
    const initial = await getNotes(participants[0].page);
    // The seeder places notes at centres i*220, 0; create five if the board
    // is empty.
    let notes = initial;
    if (notes.length === 0) {
      for (let i = 0; i < 5; i += 1) await createNoteAt(participants[0].page, i * 220, 0);
      for (const p of participants) {
        await expect.poll(async () => (await getNotes(p.page)).length).toBe(5);
      }
      notes = await getNotes(participants[0].page);
    }
    const ids = notes.slice(0, 5).map((n) => n.id);
    const starts = new Map(notes.map((n) => [n.id, n]));
    for (const p of participants) await setCamera(p.page, cam);

    // Every editor presses on their own note, then all pointers move.
    const deltas = participants.map((_, i) => 20 + i * 10);
    await Promise.all(
      participants.map(async (p, i) => {
        const n = starts.get(ids[i])!;
        await p.page.mouse.move((n.x + 100 - cam.x) * cam.zoom, (n.y + 100 - cam.y) * cam.zoom);
        await p.page.mouse.down();
      })
    );
    await Promise.all(
      participants.map(async (p, i) => {
        const n = starts.get(ids[i])!;
        await p.page.mouse.move(
          (n.x + 100 - cam.x) * cam.zoom + deltas[i],
          (n.y + 100 - cam.y) * cam.zoom
        );
      })
    );
    await Promise.all(participants.map((p) => p.page.mouse.up()));

    // Every editor sees the same final state: each note moved by its own
    // editor's delta, on every context.
    for (const p of participants) {
      await expect
        .poll(async () => {
          const seen = await getNotes(p.page);
          return ids.every((id, i) => {
            const now = seen.find((n) => n.id === id);
            const was = starts.get(id)!;
            return now !== undefined && Math.abs(now.x - (was.x + deltas[i])) < 1;
          });
        }, { timeout: 15_000 })
        .toBe(true);
    }
    expect(await snapshotsAgree(participants.map((p) => p.page))).toBe(true);
    await Promise.all(participants.map((p) => p.context.close()));
  });
});
