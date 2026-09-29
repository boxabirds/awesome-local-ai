// Story 7, e2e (TC-32 .. TC-36): marquee, group move/resize, keyboard, the
// live prune, and full-capacity convergence. Runs against `wrangler dev`
// (chromium required; TC-32 also passes in firefox/webkit).

import { expect, test } from '@playwright/test';
import { newBoard, openParticipant, closeParticipant, expectWithin, type Participant } from './participants';
import {
  seedNotes,
  parkCamera,
  expectNoteCount,
  noteWorld,
  noteId,
  selectedIds,
  marqueeDrag,
  dragHandle,
  dragNote,
  seededNoteTopLeft,
} from './helpers/story7';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

// Camera that fits the whole board with the origin at the viewport origin.
const ZOOM1 = { x: 0, y: 0, zoom: 1 };

test.describe('story 7 e2e (TC-32..TC-36)', () => {
  test('TC-32: shift+drag marquee selects only the notes fully inside', async ({ page, baseURL }) => {
    const boardId = await newBoard(baseURL!);
    await seedNotes(baseURL!, boardId, 3);
    await page.goto(`/b/${boardId}`);
    await expectNoteCount(page, 3);
    await parkCamera(page, ZOOM1);

    // Marquee over the first note's cell only: fully contains note 0 (x 40..240)
    // and stops short of note 1 (x 260) so exactly one note is selected.
    const n0 = seededNoteTopLeft(0);
    await marqueeDrag(page, ZOOM1, n0.x - 10, n0.y - 10, n0.x + 210, n0.y + 210);

    const sel = await selectedIds(page);
    expect(sel).toHaveLength(1);
  });

  test('TC-33: dragging one note moves the whole selection; se handle scales the group', async ({ page, baseURL }) => {
    const boardId = await newBoard(baseURL!);
    await seedNotes(baseURL!, boardId, 6);
    await page.goto(`/b/${boardId}`);
    await expectNoteCount(page, 6);
    // Park a camera where the 6-note row, its +300 move and the se-handle
    // resize all stay on-screen (camera origin = the viewport top-left).
    const cam = { x: -120, y: -100, zoom: 0.625 };
    await parkCamera(page, cam);

    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = await noteId(page, i);
      expect(id).toBeTruthy();
      ids.push(id as string);
    }

    // Ctrl+A selects everything.
    await page.keyboard.press('Control+a');
    expect(await selectedIds(page)).toHaveLength(6);

    const before = [];
    for (const id of ids) before.push(await noteWorld(page, id));

    // Drag one note: the whole selection moves by (300, 0). Tolerance is a few
    // world units: a 16-step pointer drag lands within sub-pixel of the target
    // on chromium but can overshoot by ~1px on firefox/webkit.
    await dragNote(page, ids[0], 300, 0, cam.zoom);
    const afterMove = [];
    for (const id of ids) afterMove.push(await noteWorld(page, id));
    for (let i = 0; i < 6; i++) {
      expect(afterMove[i].x).toBeCloseTo(before[i].x + 300, -1);
      expect(afterMove[i].y).toBeCloseTo(before[i].y, -1);
    }

    // Resize via the se handle (world delta (200, 0)): sizes and gaps grow.
    const mid = afterMove;
    await dragHandle(page, 'se', 200, 0, cam.zoom);
    const after = [];
    for (const id of ids) after.push(await noteWorld(page, id));
    for (let i = 0; i < 6; i++) {
      expect(after[i].w).toBeGreaterThan(mid[i].w);
    }
    // Gaps scale: the horizontal span of the row grows. Use min/max because DOM
    // order is creation order, not spatial (seeded in the same ms -> id tiebreak).
    const span = (rs: { x: number }[]) => Math.max(...rs.map((r) => r.x)) - Math.min(...rs.map((r) => r.x));
    const beforeSpan = span(mid);
    const afterSpan = span(after);
    expect(afterSpan).toBeGreaterThan(beforeSpan);
  });

  test('TC-34: arrow keys nudge by 1 (Shift by 10); Delete removes the selection', async ({ page, baseURL }) => {
    const boardId = await newBoard(baseURL!);
    await seedNotes(baseURL!, boardId, 6);
    await page.goto(`/b/${boardId}`);
    await expectNoteCount(page, 6);
    await parkCamera(page, ZOOM1);

    await page.keyboard.press('Control+a');
    expect(await selectedIds(page)).toHaveLength(6);

    const id0 = (await noteId(page, 0)) as string;
    const start = await noteWorld(page, id0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const moved = await noteWorld(page, id0);
    expect(moved.x).toBeCloseTo(start.x + 13, 0);

    await page.keyboard.press('Delete');
    await expect(page.locator('.sticky-note')).toHaveCount(0);
    expect(await selectedIds(page)).toHaveLength(0);
  });

  test("TC-35: one peer deleting shrinks the other peer's live selection", async ({ browser, baseURL }) => {
    const boardId = await newBoard(baseURL!);
    const lee = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await seedNotes(baseURL!, boardId, 4);
      for (const p of [lee, sam]) {
        await p.page.goto(`/b/${boardId}`);
        await expectNoteCount(p.page, 4);
        await parkCamera(p.page, ZOOM1);
      }

      await lee.page.keyboard.press('Control+a');
      expect(await selectedIds(lee.page)).toHaveLength(4);
      expect(await lee.page.locator('.selection-bar__count').innerText()).toContain('4 selected');

      // Sam deletes the first note (click it, then Delete); Lee's live
      // selection prunes to three.
      const id0 = (await noteId(sam.page, 0)) as string;
      await sam.page.locator(`.sticky-note[data-note-id="${id0}"]`).click();
      await sam.page.keyboard.press('Delete');

      await expectWithin(
        () => lee.page.locator('.selection-bar__count').innerText().then((t) => t.includes('3 selected')),
        true,
        8000,
      );

      await lee.page.keyboard.press('Delete');
      await expectWithin(
        () => lee.page.locator('.sticky-note').count(),
        0,
        8000,
      );
    } finally {
      await closeParticipant(lee);
      await closeParticipant(sam);
    }
  });

  test('TC-36: concurrent group moves across every context converge', async ({ browser, baseURL }) => {
    const n = MAX_CONCURRENT_EDITORS;
    const boardId = await newBoard(baseURL!);
    const participants: Participant[] = [];
    try {
      for (let c = 0; c < n; c++) {
        participants.push(await openParticipant(browser, boardId));
      }
      await seedNotes(baseURL!, boardId, 2 * n);
      // Park a camera where the whole row (world x 40..2220) and every marquee
      // band fit (camera origin = the viewport top-left).
      const cam = { x: -900, y: -100, zoom: 0.4 };
      for (const p of participants) {
        await p.page.goto(`/b/${boardId}`);
        await expectNoteCount(p.page, 2 * n);
        await parkCamera(p.page, cam);
      }

      // Move the end contexts' pairs AWAY from their neighbours so a prior
      // context's synced move can never land inside the next marquee band.
      const offsets = [-200, 0, 0, 0, 200];
      for (let c = 0; c < n; c++) {
        const page = participants[c].page;
        const x0 = seededNoteTopLeft(2 * c).x;
        // Marquee a band that holds exactly this context's two notes.
        await marqueeDrag(page, cam, x0 - 10, 30, x0 + 430, 250);
        const moved = await selectedIds(page);
        expect(moved).toHaveLength(2);
        await dragNote(page, moved[0], offsets[c % offsets.length], 100, cam.zoom);
      }

      // Every context converges to the identical set of note positions.
      await expectWithin(
        async () => {
          const sets = [];
          for (const p of participants) {
            const ids: string[] = [];
            for (let i = 0; i < 2 * n; i++) ids.push((await noteId(p.page, i)) as string);
            const recs = await Promise.all(ids.map((id) => noteWorld(p.page, id)));
            sets.push(
              recs
                .map((r) => `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.w.toFixed(1)}`)
                .sort()
                .join('|'),
            );
          }
          return new Set(sets).size === 1;
        },
        true,
        12_000,
      );
    } finally {
      for (const p of participants) await closeParticipant(p);
    }
  });
});
