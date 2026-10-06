import { expect, test } from "@playwright/test";
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from "../../src/shared/config";
import * as board from "./helpers/board";
import * as notes from "./helpers/notes";
import * as selection from "./helpers/selection";
import { expectEventually, expectNoProblems, openSession, type Session } from "./helpers/participants";

/**
 * Story 7, task 15 — reorganising a cluster in a real browser.
 *
 * TC-32 (the boundary of a selection rectangle), TC-33 (dragging a whole
 * selection, then resizing it from the bounding box), TC-34 (selection
 * keyboard) and TC-36 (every allowed editor reorganising at the same time).
 * Every assertion is in **board units**, measured from what the browser actually
 * painted, so neither zoom nor pan can hide a wrong gesture.
 */

const NOTE = STICKY_SIZE_WORLD;

/** Board points of a 3 x 2 cluster: boxes 100..800 by 100..500. */
const CLUSTER = [
  { x: 200, y: 200 },
  { x: 450, y: 200 },
  { x: 700, y: 200 },
  { x: 200, y: 400 },
  { x: 450, y: 400 },
  { x: 700, y: 400 },
];

test.describe("workflow: reorganise a cluster", () => {
  test("TC-32 a selection rectangle selects only what lies entirely inside it", async ({ page }) => {
    await board.openBoard(page);
    await selection.centreOn(page, { x: 450, y: 350 });

    const [inside, clipped, outside] = await selection.createNotes(page, [
      { x: 250, y: 250 }, // box 150..350: entirely inside the rectangle below
      { x: 450, y: 350 }, // box 350..550: the rectangle cuts it
      { x: 900, y: 600 }, // box 800..1000: nowhere near it
    ]);
    await selection.clearSelection(page);

    // The rectangle reaches (400, 400): the first note ends at 350, the clipped
    // one at 550, so exactly one of them is inside.
    await selection.marquee(page, { x: -30, y: -30 }, { x: 400, y: 400 });

    const state = await selection.selectionState(page);
    expect(state.selected).toBe(1);
    expect(await selection.selectedIds(page)).toEqual([inside]);
    expect(state.outlines).toBe(1);
    expect(state.marquee).toBe(false);
    expect(state.count).toBe(null);

    // While the button is still held down the rectangle itself is visible.
    const from = await selection.screenOf(page, { x: -30, y: -30 });
    const to = await selection.screenOf(page, { x: 400, y: 400 });
    await page.keyboard.down("Shift");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y);
    await expect(page.getByTestId("marquee-rect")).toHaveCount(1);
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await notes.settle(page);
    expect(await selection.selectedIds(page)).toEqual([inside]);
    expect(await notes.noteCount(page)).toBe(3);

    // Nothing moved: the note that was never touched is still under the point it
    // was created at.
    const far = await selection.screenOf(page, { x: 900, y: 600 });
    expect(await notes.paintedNoteIdAt(page, far.x, far.y)).toBe(outside);
    expect(clipped).toBeTruthy();
  });

  test("TC-33 dragging one note of a selected cluster moves all of them and brings them to the front", async ({
    page,
  }) => {
    await board.openBoard(page);
    await selection.centreOn(page, { x: 500, y: 350 }, 0.75);

    const cluster = await selection.createNotes(page, CLUSTER);
    // A note nobody selected, sitting where the cluster will end up.
    const [unselected] = await selection.createNotes(page, [{ x: 1000, y: 200 }]);
    await selection.clearSelection(page);

    await selection.marquee(page, { x: 50, y: 50 }, { x: 850, y: 550 });
    expect((await selection.selectionState(page)).selected).toBe(6);

    const before = await selection.worldBoxes(page, [...cluster, unselected]);
    await selection.dragObjectBy(page, cluster[0]!, { x: 300, y: 0 });
    const after = await selection.worldBoxes(page, [...cluster, unselected]);

    for (const id of cluster) {
      const b = before.get(id)!;
      const a = after.get(id)!;
      expectWithin(a.x - b.x, 300);
      expectWithin(a.y - b.y, 0);
    }
    // The gaps inside the cluster are unchanged, and the object outside it did
    // not move at all.
    expectWithin(
      after.get(cluster[1]!)!.x - after.get(cluster[0]!)!.x,
      before.get(cluster[1]!)!.x - before.get(cluster[0]!)!.x,
    );
    expectWithin(after.get(unselected)!.x, before.get(unselected)!.x);

    // The moved notes are drawn above the note they now cover: the cluster's
    // third column landed exactly on it.
    const overlap = await selection.screenOf(page, { x: 1000, y: 200 });
    const onTop = await notes.paintedNoteIdAt(page, overlap.x, overlap.y);
    expect(cluster).toContain(onTop);
    expect(onTop).not.toBe(unselected);

    // Still selected, so the person can keep going.
    expect((await selection.selectionState(page)).selected).toBe(6);
  });

  test("TC-33 the bounding box resize scales the whole selection, keeps notes square and stops at the minimum size", async ({
    page,
  }) => {
    await board.openBoard(page);
    // Zoom 1 here: board units and screen pixels agree one to one, so a rendered
    // position is at most half a unit away from the model's.
    await selection.centreOn(page, { x: 450, y: 300 });

    const cluster = await selection.createNotes(page, CLUSTER);
    await selection.clearSelection(page);
    await selection.marquee(page, { x: 50, y: 50 }, { x: 850, y: 550 });
    expect((await selection.selectionState(page)).selected).toBe(6);

    // The cluster is 700 x 400 board units; growing the bottom-right corner by
    // 70 x 40 scales everything by 1.1.
    await selection.dragHandleBy(page, "se", { x: 70, y: 40 });

    const scaled = await selection.worldBoxes(page, cluster);
    for (const id of cluster) {
      const box = scaled.get(id)!;
      expectWithin(box.width, NOTE * 1.1);
      // Sticky notes stay square: nothing was stretched to fit the box.
      expectWithin(box.width, box.height);
    }
    // The gaps scale with the notes.
    const first = scaled.get(cluster[0]!)!;
    const second = scaled.get(cluster[1]!)!;
    expectWithin(second.x - (first.x + first.width), 55);

    // Shrinking far past the minimum — pulling the bottom-right corner clean
    // through the board — stops at the minimum instead of vanishing.
    await selection.dragHandleBy(page, "se", { x: -3_000, y: -3_000 });
    const clamped = await selection.worldBoxes(page, cluster);
    for (const id of cluster) {
      const box = clamped.get(id)!;
      expect(box.width).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1);
      expect(box.height).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1);
    }
    const sizes = cluster.map((id) => clamped.get(id)!.width);
    expect(Math.min(...sizes)).toBeLessThan(NOTE);
    expectWithin(Math.min(...sizes), STICKY_MIN_SIZE_WORLD);
  });

  test("TC-34 the arrows nudge the whole selection without panning the board or scrolling the page, Delete removes it", async ({
    page,
  }) => {
    await board.openBoard(page);
    await selection.centreOn(page, { x: 450, y: 300 }, 0.75);

    const cluster = await selection.createNotes(page, CLUSTER);
    const other = await selection.createNotes(page, [{ x: 1150, y: 650 }]);
    await selection.clearSelection(page);
    await selection.marquee(page, { x: 50, y: 50 }, { x: 850, y: 550 });

    const camera = await board.readCamera(page);
    const before = await selection.worldBoxes(page, [...cluster, ...other]);

    await selection.pressKeys(page, "ArrowRight", 3);
    await selection.pressKeys(page, "ArrowRight", 1, true);

    const after = await selection.worldBoxes(page, [...cluster, ...other]);
    const expected = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    for (const id of cluster) {
      expectWithin(after.get(id)!.x - before.get(id)!.x, expected);
    }
    for (const id of other) {
      expectWithin(after.get(id)!.x, before.get(id)!.x);
    }

    // The board itself did not move, and the page did not scroll.
    expect(await board.readCamera(page)).toEqual(camera);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.keyboard.press("Delete");
    await notes.settle(page);
    expect(await notes.noteCount(page)).toBe(1);
    const state = await selection.selectionState(page);
    expect(state.selected).toBe(0);
    expect(state.bar).toBe(false);
  });

  test("TC-36 every allowed editor reorganises at the same time and every screen ends with the same board", async ({
    browser,
  }) => {
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, index) => `Editor ${index + 1}`);
    const session: Session = await openSession(browser, names);
    try {
      const pages = session.participants.map((participant) => participant.page);
      // Everyone looks at the board from the same place, so a drag on one screen
      // is the same distance on every other screen.
      await selection.centreOn(pages[0]!, { x: 525, y: 400 });
      const ids = await selection.createNotes(
        pages[0]!,
        [150, 400, 650].flatMap((y) => [150, 400, 650, 900].map((x) => ({ x, y }))),
      );
      for (const page of pages.slice(1)) {
        // A background tab defers React's work, so bring the page forward long
        // enough for it to paint the camera the test asked for.
        await page.bringToFront();
        await selection.centreOn(page, { x: 525, y: 400 });
        await notes.settle(page);
      }

      // Each editor takes a different selection, and three notes belong to two
      // editors at once: those are dragged by two people at the same time. The
      // note a person presses belongs to that person alone, so their drag is a
      // drag and not a fight over the pointer. Notes 10 and 11 are in nobody's
      // selection.
      const selections = [[0, 5], [1, 5, 6], [2, 6, 9], [3, 7], [4, 8, 9]].map((group) =>
        group.map((index) => ids[index]!),
      );
      const deltas = [
        { x: 40, y: 30 },
        { x: 60, y: 20 },
        { x: 30, y: 50 },
        { x: -40, y: 35 },
        { x: 45, y: -25 },
      ];
      const before = await selection.worldBoxes(pages[0]!, ids);
      const cameras = await Promise.all(pages.map((page) => board.readCamera(page)));
      let lastDrift = 0;

      await Promise.all(
        pages.map(async (page, index) => {
          await selection.selectIds(page, selections[index]!);
          expect((await selection.selectionState(page)).selected).toBe(selections[index]!.length);
          await selection.dragObjectBy(page, selections[index]![0]!, deltas[index]!);
        }),
      );

      // Every screen agrees on where every note is. The last write of a gesture
      // is still travelling, so the agreement is waited for, not assumed.
      const convergedAfterMs = await expectEventually(
        "TC-36 all screens agree on the board",
        async () => {
          const perScreen = await Promise.all(pages.map((page) => selection.worldBoxes(page, ids)));
          const reference = perScreen[0]!;
          let drift = 0;
          for (const boxes of perScreen) {
            for (const id of ids) {
              drift = Math.max(
                drift,
                Math.abs(boxes.get(id)!.x - reference.get(id)!.x),
                Math.abs(boxes.get(id)!.y - reference.get(id)!.y),
              );
            }
          }
          lastDrift = drift;
          return drift <= 1;
        },
        10_000,
      );
      expect(convergedAfterMs).toBeLessThan(10_000);
      expect(lastDrift).toBeLessThanOrEqual(1);

      const final = await selection.worldBoxes(pages[0]!, ids);

      // Each person's reorganisation took effect: the note each one pressed ended
      // where that person dragged it, nobody else's screen having overruled it.
      for (const [index, selection] of selections.entries()) {
        const pressed = selection[0]!;
        expectWithin(final.get(pressed)!.x - before.get(pressed)!.x, deltas[index]!.x);
        expectWithin(final.get(pressed)!.y - before.get(pressed)!.y, deltas[index]!.y);
      }

      // The notes nobody selected stayed where they were, and no screen turned a
      // drag into a pan.
      for (const index of [10, 11]) {
        const id = ids[index]!;
        expectWithin(final.get(id)!.x, before.get(id)!.x);
        expectWithin(final.get(id)!.y, before.get(id)!.y);
      }
      const afterCameras = await Promise.all(pages.map((page) => board.readCamera(page)));
      expect(afterCameras).toEqual(cameras);

      // The notes two editors fought over still exist once each, at one place,
      // on every screen, and they did move.
      expect(await notes.noteCount(pages[0]!), "no note was duplicated").toBe(ids.length);
      for (const index of [5, 6, 9]) {
        const id = ids[index]!;
        const moved =
          Math.abs(final.get(id)!.x - before.get(id)!.x) + Math.abs(final.get(id)!.y - before.get(id)!.y);
        expect(moved, `contended note ${index} moved`).toBeGreaterThan(1);
      }
      expectNoProblems(session.participants);
    } finally {
      await session.close();
    }
  });
});

/**
 * Board-unit comparison with room for the half unit a rendered position rounds
 * to. The board is measured as the browser painted it, so exactness below a unit
 * is not something a screen can show.
 */
function expectWithin(actual: number, expected: number, tolerance = 1): void {
  expect(
    Math.abs(actual - expected),
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
}
