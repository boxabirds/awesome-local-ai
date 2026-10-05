/**
 * Story 7 e2e (tasks 5 and 15): TC-32 to TC-36.
 *
 * Everything here is driven the way a person drives it — Shift+drag, pointer on
 * a handle, arrow keys — and read back from the model through the test-only
 * `window.__vidi6.getBoard` hook, because "it moved 300 units" is a fact about
 * the board, not about a pixel.
 *
 * The camera is always set explicitly: at zoom `z` a world point appears at
 * `640 + wx*z`, `400 + wy*z` in a 1280x800 viewport, so the fixture below is
 * written in world units and converted for the pointer.
 */
import { expect, test } from '@playwright/test';

import {
  MAX_CONCURRENT_EDITORS,
  STICKY_MIN_SIZE_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
} from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  boardKey,
  boardOf,
  closeParticipants,
  createBoard,
  expectEventually,
  openParticipant,
  openParticipants,
  waitForBoardsEqual,
} from './helpers/participants';
import { setCamera, worldTranslate } from './helpers/board';
import {
  clearSelection,
  createNoteAtScreen,
  marqueeRect,
  positionsOf,
  resizeHandle,
  resizeHandles,
  selectNotes,
  selectedIds,
  selectedNotes,
  selectionBar,
  selectionCount,
  selectionLive,
  shiftDragBy,
} from './helpers/selection';
import { centredCamera, dragBy, noteById, notes } from './helpers/sticky-notes';

/** Screen point of a world point for a centred camera at `zoom`. */
function screenOf(world: { x: number; y: number }, zoom: number): { x: number; y: number } {
  return { x: 640 + world.x * zoom, y: 400 + world.y * zoom };
}

test.describe('select, move, resize and delete several objects at once', () => {
  test('TC-32 Shift+drag selects what the rectangle holds', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    try {
      const zoom = 0.4;
      await setCamera(alex.page, centredCamera(zoom));

      // A: world 200x200 around the origin — the rectangle will hold it.
      // B: 150 units to the right — half of it outside the rectangle.
      // C: far away — nowhere near it.
      const a = await createNoteAtScreen(alex, ...coords(screenOf({ x: 0, y: 0 }, zoom)), 'A');
      const b = await createNoteAtScreen(alex, ...coords(screenOf({ x: 150, y: 0 }, zoom)), 'B');
      const c = await createNoteAtScreen(alex, ...coords(screenOf({ x: 700, y: 400 }, zoom)), 'C');
      await clearSelection(alex.page);

      const from = { x: 560, y: 340 };
      const to = { x: 690, y: 470 };
      await shiftDragBy(alex.page, from, to.x - from.x, to.y - from.y, {
        whileDragging: async () => {
          // The rectangle is visible while the pointer is down, so the user can
          // see what they are about to take.
          await expect(marqueeRect(alex.page)).toBeVisible();
        },
      });
      await expect(marqueeRect(alex.page)).toHaveCount(0);

      // Only the note the rectangle fully contains. Half of B is inside, which is
      // not the same thing as inside.
      await expect.poll(() => selectedIds(alex.page)).toEqual([a.id]);
      expect(await noteById(alex.page, b.id).getAttribute('data-selected')).toBe('false');
      expect(await noteById(alex.page, c.id).getAttribute('data-selected')).toBe('false');
      // One object selected: the note's own toolbar rather than the group bar.
      await expect(alex.page.getByRole('toolbar', { name: 'Sticky note options' })).toBeVisible();

      // The rectangle adds to the selection instead of replacing it.
      const centreC = screenOf({ x: 700, y: 400 }, zoom);
      await alex.page.mouse.click(centreC.x, centreC.y);
      await expect.poll(() => selectedIds(alex.page)).toEqual([c.id]);
      await shiftDragBy(alex.page, from, to.x - from.x, to.y - from.y);
      await expect.poll(() => selectedIds(alex.page)).toEqual([a.id, c.id].sort());
      await expect(selectionCount(alex.page)).toHaveText('2 selected');

      // Without Shift the same drag is story 1's pan: no rectangle, and a pan is
      // not a click, so the selection is untouched.
      const before = await worldTranslate(alex.page);
      const beforeSelection = await selectedIds(alex.page);
      await alex.page.mouse.move(200, 700);
      await alex.page.mouse.down();
      await alex.page.mouse.move(200, 700, { steps: 1 });
      await alex.page.mouse.move(280, 740, { steps: 8 });
      expect(await marqueeRect(alex.page).count()).toBe(0);
      await alex.page.mouse.up();
      expect((await worldTranslate(alex.page)).tx).not.toBe(before.tx);
      await expect.poll(() => selectedIds(alex.page)).toEqual(beforeSelection);

      expect(alex.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants([alex]);
    }
  });

  test('TC-33 a group of notes moves together, above the others, and scales as one picture', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    try {
      const zoom = 0.4;
      await setCamera(alex.page, centredCamera(zoom));
      const at = (world: { x: number; y: number }) => screenOf(world, zoom);

      // Created first, so it sits under everything: the cluster will be dragged
      // onto it and has to end up on top.
      const under = await createNoteAtScreen(alex, ...coords(at({ x: 600, y: 0 })), 'under');

      // A 3 x 2 cluster with 60 unit gaps.
      const cluster: { x: number; y: number }[] = [];
      for (const y of [-310, -50]) {
        for (const x of [-520, -260, 0]) cluster.push({ x, y });
      }
      const created: StickySnapshot[] = [];
      for (const [index, world] of cluster.entries()) {
        created.push(await createNoteAtScreen(alex, ...coords(at(world)), `g${index + 1}`));
      }
      const ids = created.map((note) => note.id);
      await selectNotes(alex.page, ids);
      await expect(resizeHandles(alex.page)).toHaveCount(8);

      // --- move: one note is dragged, all six follow exactly ---------------
      const before = await positionsOf(alex);
      const move = { x: 700, y: 300 };
      const grab = at({ x: -520, y: -310 });
      await dragBy(alex.page, grab, move.x * zoom, move.y * zoom);

      const moved = await positionsOf(alex);
      for (const id of ids) {
        expect(moved.get(id)!.x, `note ${id} x`).toBeCloseTo(before.get(id)!.x + move.x, 1);
        expect(moved.get(id)!.y, `note ${id} y`).toBeCloseTo(before.get(id)!.y + move.y, 1);
      }
      // The note nobody touched stayed put.
      expect(moved.get(under.id)).toEqual(before.get(under.id));

      // The thing being moved is on top, and it stayed that way after release.
      for (const id of ids) {
        expect(moved.get(id)!.z, `note ${id} above the untouched one`).toBeGreaterThan(
          moved.get(under.id)!.z,
        );
      }
      // Where the cluster now covers the other note, the cluster is what the
      // pointer would find.
      const overPoint = at({ x: 520, y: 0 });
      const topId = await alex.page.evaluate(([x, y]) => {
        const element = document.elementFromPoint(x, y);
        return element?.closest('[data-note-id]')?.getAttribute('data-note-id') ?? null;
      }, [overPoint.x, overPoint.y]);
      expect(topId).toBe(ids[1]);

      // --- resize: the corners scale sizes *and* gaps ----------------------
      const handle = resizeHandle(alex.page, 'Resize bottom-right');
      const handleBox = await handle.boundingBox();
      if (!handleBox) throw new Error('the resize handle has no bounding box');
      const grow = { x: 200, y: 200 };
      await dragBy(
        alex.page,
        { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
        grow.x * zoom,
        grow.y * zoom,
      );

      const grown = await positionsOf(alex);
      const widths = ids.map((id) => grown.get(id)!.width);
      for (const id of ids) {
        // Notes are squares, and sticky notes stay squares.
        expect(grown.get(id)!.height, `note ${id} is square`).toBeCloseTo(
          grown.get(id)!.width,
          1,
        );
        expect(grown.get(id)!.width).toBeGreaterThan(before.get(id)!.width);
        // Nothing was resized that was not selected.
        expect(grown.get(under.id)!.width).toBe(before.get(under.id)!.width);
      }
      expect(new Set(widths.map((w) => w.toFixed(2))).size).toBe(1);

      // The anchor corner did not move: the cluster grew away from it. The corner
      // is measured against where the notes were when the resize began, which is
      // after the move above.
      const anchor = ids.reduce((best, id) =>
        grown.get(id)!.x < grown.get(best)!.x ? id : best,
      );
      expect(grown.get(anchor)!.x).toBeCloseTo(moved.get(anchor)!.x, 1);

      // The gap between two neighbours grew by the same ratio as the notes, which
      // is what makes the result read as the same cluster, larger.
      const ratio = grown.get(ids[1])!.width / moved.get(ids[1])!.width;
      const gapBefore =
        moved.get(ids[1])!.x - moved.get(ids[0])!.x - moved.get(ids[1])!.width;
      const gapAfter = grown.get(ids[1])!.x - grown.get(ids[0])!.x - grown.get(ids[1])!.width;
      expect(gapAfter).toBeCloseTo(gapBefore * ratio, 1);

      // --- and shrinking stops at the note's own minimum -------------------
      const handle2 = await resizeHandle(alex.page, 'Resize bottom-right').boundingBox();
      if (!handle2) throw new Error('the resize handle vanished');
      await dragBy(
        alex.page,
        { x: handle2.x + handle2.width / 2, y: handle2.y + handle2.height / 2 },
        -1000 * zoom,
        -1000 * zoom,
      );
      const shrunk = await positionsOf(alex);
      for (const id of ids) {
        // Not one note went below the minimum its type allows, and none flipped.
        expect(shrunk.get(id)!.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 1);
        expect(shrunk.get(id)!.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 1);
      }
      expect(await notes(alex.page).count()).toBe(ids.length + 1);
      expect(alex.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants([alex]);
    }
  });

  test('TC-34 arrow keys nudge the selection; Delete removes it', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    try {
      const zoom = 0.5;
      await setCamera(alex.page, centredCamera(zoom));
      const at = (world: { x: number; y: number }) => screenOf(world, zoom);

      const one = await createNoteAtScreen(alex, ...coords(at({ x: 0, y: 0 })), 'one');
      const two = await createNoteAtScreen(alex, ...coords(at({ x: 300, y: 0 })), 'two');
      const three = await createNoteAtScreen(alex, ...coords(at({ x: 0, y: 300 })), 'three');
      const kept = await createNoteAtScreen(alex, ...coords(at({ x: -500, y: -400 })), 'kept');
      await selectNotes(alex.page, [one.id, two.id, three.id]);

      const translateBefore = await worldTranslate(alex.page);
      const before = await positionsOf(alex);

      for (let i = 0; i < 3; i += 1) await alex.page.keyboard.press('ArrowRight');
      await alex.page.keyboard.press('Shift+ArrowRight');

      const nudged = await positionsOf(alex);
      const step = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
      for (const id of [one.id, two.id, three.id]) {
        expect(nudged.get(id)!.x).toBeCloseTo(before.get(id)!.x + step, 6);
        expect(nudged.get(id)!.y).toBeCloseTo(before.get(id)!.y, 6);
      }
      // The note that was not selected is not part of a nudge.
      expect(nudged.get(kept.id)).toEqual(before.get(kept.id));

      // Nothing else happened: the page did not scroll and the board did not pan.
      expect(await alex.page.evaluate(() => window.scrollY)).toBe(0);
      const translateAfter = await worldTranslate(alex.page);
      expect(translateAfter).toEqual(translateBefore);

      await alex.page.keyboard.press('Delete');
      await expect(notes(alex.page)).toHaveCount(1);
      await expect(selectedNotes(alex.page)).toHaveCount(0);
      await expect(selectionBar(alex.page)).toHaveCount(0);
      await expect(selectionLive(alex.page)).toHaveText('Selection cleared');
      const board = await boardOf(alex);
      expect(board.map((note) => note.id)).toEqual([kept.id]);
      expect(alex.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants([alex]);
    }
  });

  test('TC-35 a colleague deleting one of my selected notes drops it from my selection', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);
    try {
      const zoom = 0.5;
      for (const participant of [alex, sam]) {
        await setCamera(participant.page, centredCamera(zoom));
      }
      const at = (world: { x: number; y: number }) => screenOf(world, zoom);

      const one = await createNoteAtScreen(alex, ...coords(at({ x: -300, y: 0 })), 'one');
      const two = await createNoteAtScreen(alex, ...coords(at({ x: 0, y: 0 })), 'two');
      const three = await createNoteAtScreen(alex, ...coords(at({ x: 300, y: 0 })), 'three');
      await selectNotes(alex.page, [one.id, two.id, three.id]);
      await expect(selectionLive(alex.page)).toHaveText('3 objects selected');

      // Sam sees the same three notes and deletes one of them.
      await expectEventually(
        'TC-35 Sam sees the notes',
        () => boardOf(sam),
        (board) => board.length === 3,
      );
      const middle = at({ x: 0, y: 0 });
      await sam.page.mouse.click(middle.x, middle.y);
      await sam.page.keyboard.press('Delete');
      await expectEventually(
        'TC-35 Sam deleted one',
        () => boardOf(sam),
        (board) => board.length === 2,
      );

      // Alex's board loses the note and, because the selection can only hold
      // things that exist, Alex's selection loses it too — no phantom count, no
      // bar offering to delete nothing.
      await expectEventually(
        'TC-35 Alex selection pruned',
        async () => ({
          board: await boardOf(alex),
          selected: await selectedIds(alex.page),
        }),
        ({ board, selected }) => board.length === 2 && selected.length === 2,
      );
      const remaining = (await boardOf(alex)).map((note) => note.id).sort();
      expect(await selectedIds(alex.page)).toEqual(remaining);
      expect(remaining).toEqual([one.id, three.id].sort());
      await expect(selectionCount(alex.page)).toHaveText('2 selected');
      expect(alex.consoleErrors).toEqual([]);
      expect(sam.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-36 every editor moving their own notes ends in the same place', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const boardId = await createBoard(request);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor${i + 1}`);
    const participants = await openParticipants(browser, boardId, names);
    try {
      const zoom = 0.5;
      for (const participant of participants) {
        await setCamera(participant.page, centredCamera(zoom));
      }

      // One note per editor, in a row, spaced so a move cannot hide a neighbour.
      const world = (i: number) => ({ x: -400 + i * 200, y: -200 });
      const created: StickySnapshot[] = [];
      for (let i = 0; i < participants.length; i += 1) {
        created.push(
          await createNoteAtScreen(participants[0], ...coords(screenOf(world(i), zoom)), `n${i + 1}`),
        );
      }
      await waitForBoardsEqual(participants, 'TC-36 everyone has every note');

      // Where each note is going: a different push for each, so a lost write would
      // show up as a note in the wrong place.
      const pushes = created.map((note, i) => ({
        id: note.id,
        dx: 100 + i * 20,
        dy: i % 2 === 0 ? -120 : 120,
      }));
      const start = await positionsOf(participants[0]);

      // All at the same time: each editor selects and drags their own note.
      await Promise.all(
        participants.map(async (participant, i) => {
          const note = created[i];
          await selectNotes(participant.page, [note.id]);
          const centre = screenOf(
            { x: start.get(note.id)!.x + 100, y: start.get(note.id)!.y + 100 },
            zoom,
          );
          await dragBy(participant.page, centre, pushes[i].dx * zoom, pushes[i].dy * zoom);
        }),
      );

      // Absolute writes, so the five boards converge on one answer and every
      // editor sees the same one.
      await waitForBoardsEqual(participants, 'TC-36 simultaneous moves converge');
      for (const participant of participants) {
        const board = await positionsOf(participant);
        expect(board.size).toBe(created.length);
        for (const push of pushes) {
          expect(board.get(push.id)!.x, `${push.id} x on ${participant.name}`).toBeCloseTo(
            start.get(push.id)!.x + push.dx,
            1,
          );
          expect(board.get(push.id)!.y, `${push.id} y on ${participant.name}`).toBeCloseTo(
            start.get(push.id)!.y + push.dy,
            1,
          );
        }
      }
      const keys = await Promise.all(participants.map((p) => boardOf(p).then(boardKey)));
      expect(new Set(keys).size).toBe(1);
      expect(participants.flatMap((p) => p.consoleErrors)).toEqual([]);
    } finally {
      await closeParticipants(participants);
    }
  });
});

/** Spread a `{x, y}` into the two positional arguments `createNoteAtScreen` wants. */
function coords(point: { x: number; y: number }): [number, number] {
  return [point.x, point.y];
}
