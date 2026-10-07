import { test, expect } from "@playwright/test";
import { createSticky, getStickyText } from "../../src/shared/board-model";
import { PEN_THICKNESS_WORLD } from "../../src/shared/config";
import { boardCentre, renderedCamera } from "./helpers/board";
import { notes, settle, worldOf } from "./helpers/notes";
import {
  armPen,
  choosePen,
  clickPen,
  drawStroke,
  leavePen,
  movePen,
  newStrokeSince,
  pathStart,
  penToolbarVisible,
  pressPen,
  previewChanges,
  previewD,
  previewFrames,
  releasePen,
  startPreviewSampling,
  stopPreviewSampling,
  strokeById,
  strokeCount,
  strokeIds,
  strokes,
} from "./helpers/pen";
import {
  centreOn,
  dragHandleBy,
  dragObjectBy,
  pressKeys,
  screenOf,
  selectedIds,
} from "./helpers/selection";
import {
  expectEventually,
  expectNoProblems,
  openParticipant,
  openSession,
  reportLatencies,
  resetLatencies,
  type Participant,
} from "./helpers/participants";
import { createBoard } from "./helpers/api";
import { roomObjects, writeBoard } from "./helpers/shapes";
import { handwrittenLoop, underlinePath } from "../fixtures/pen-paths";

/**
 * Story 11, task 3 (TC-17 to TC-20): a person sketching on the board.
 *
 * Pen drags are real drags — the mouse goes down, visits hundreds of points and comes
 * up — and the assertions are about what the browser shows: the preview line the tool
 * draws while the pen is down, the stroke that appears when it is released, and what
 * another participant does and does not see in between. Distances are measured in
 * board units, converted through the camera each page is rendered with, so a
 * measurement does not depend on the zoom a test happened to be at.
 */

const CLUSTER = { x: 300, y: 240 };
const LOOP = handwrittenLoop(400);

function boundsOf(points: readonly { x: number; y: number }[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

async function seedCluster(boardId: string): Promise<void> {
  await writeBoard(boardId, (doc) => {
    seedNote(doc, 250, 230, "yellow", "Checkout flow");
    seedNote(doc, 420, 300, "blue", "3 failed attempts");
  });
}

function seedNote(
  doc: Parameters<typeof createSticky>[0],
  x: number,
  y: number,
  color: Parameters<typeof createSticky>[2],
  text: string,
): void {
  const id = createSticky(doc, { x, y }, color);
  if (typeof id === "string") getStickyText(doc, id)?.insert(0, text);
}

async function expectNotes(participant: Participant, count: number): Promise<void> {
  await expect.poll(async () => (await notes(participant.page)).length, { timeout: 15_000 }).toBe(count);
}

test.describe("annotate a cluster", () => {
  test("TC-17 a real drag previews the line every frame and leaves a stroke behind", async ({ browser }) => {
    resetLatencies();
    const boardId = await createBoard();
    await seedCluster(boardId);
    const priya = await openParticipant(browser, "Priya", boardId);
    try {
      await expectNotes(priya, 2);
      await centreOn(priya.page, CLUSTER);

      await armPen(priya.page);
      // The pen's own toolbar is on screen: six colours, three thicknesses.
      expect(await penToolbarVisible(priya.page)).toBe(true);
      await expect(priya.page.getByTestId("pen-colors").getByRole("button")).toHaveCount(6);
      await expect(priya.page.getByTestId("pen-thicknesses").getByRole("button")).toHaveCount(3);
      await expect(priya.page.getByTestId("pen-color-black")).toHaveAttribute("aria-pressed", "true");
      // The pointer became the pen's own round cursor.
      await expect(priya.page.getByTestId("board-viewport")).toHaveCSS("cursor", "crosshair");

      // The preview is sampled **in the page**, once per animation frame.
      const beforeLoop = await strokeIds(priya.page);
      await startPreviewSampling(priya.page);
      await drawStroke(priya.page, LOOP, { steps: 2 });
      const samples = await stopPreviewSampling(priya.page);

      // A line following the pointer, changing as the frames go by (`pen.preview`).
      expect(previewFrames(samples)).toBeGreaterThan(20);
      expect(previewChanges(samples)).toBeGreaterThan(20);

      // Nothing travelled while the pen was down, and the preview is gone with it.
      expect(await previewD(priya.page)).toBeNull();
      expect(await strokeCount(priya.page)).toBe(1);

      const drawn = await newStrokeSince(priya.page, beforeLoop);
      expect(drawn.color).toBe("black");
      expect(drawn.thickness).toBe("medium");
      expect(drawn.lineWidth).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 3);
      expect(drawn.points).toBeGreaterThan(20);
      expect(drawn.points).toBeLessThan(400);
      // The loop is where it was drawn, to within the pen's smoothing tolerance.
      const drawn2 = boundsOf(LOOP);
      const box = drawn.pathBox!;
      expect(box.x).toBeGreaterThan(drawn2.x - 15);
      expect(box.y).toBeGreaterThan(drawn2.y - 15);
      expect(box.x + box.width).toBeLessThan(drawn2.x + drawn2.width + 15);
      expect(box.y + box.height).toBeLessThan(drawn2.y + drawn2.height + 15);
      // Simplified: the stroke holds far fewer points than the drag produced.
      expect((await roomObjects(boardId, 1)).filter((object) => object.type === "stroke")).toHaveLength(1);

      // Drawing does not select and does not change the tool: the pen stays armed.
      expect(await selectedIds(priya.page)).toEqual([]);
      await expect(priya.page.getByTestId("board-viewport")).toHaveAttribute("data-tool", "pen");

      // A click is a dot: one point, drawn as a filled circle of the pen's thickness.
      const beforeDot = await strokeIds(priya.page);
      await clickPen(priya.page, { x: 700, y: 120 });
      const dot = await newStrokeSince(priya.page, beforeDot);
      expect(await strokeCount(priya.page)).toBe(2);
      expect(dot.points).toBe(1);
      expect(dot.lineWidth).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 3);
      expect(dot.width).toBeGreaterThanOrEqual(4);

      // The chosen colour and thickness are what the next stroke is drawn with.
      const beforeRed = await strokeIds(priya.page);
      await choosePen(priya.page, { color: "red", thickness: "thick" });
      await drawStroke(priya.page, underlinePath(80), { steps: 2 });
      const third = await newStrokeSince(priya.page, beforeRed);
      expect(third.color).toBe("red");
      expect(third.thickness).toBe("thick");
      expect(third.lineWidth).toBeCloseTo(PEN_THICKNESS_WORLD.thick, 3);
      expect(await strokeCount(priya.page)).toBe(3);

      await expectNoProblems([priya]);
    } finally {
      await priya.context.close();
    }
  });

  test("TC-18 the other participant sees nothing mid-drag and the finished stroke after the release", async ({ browser }) => {
    resetLatencies();
    const session = await openSession(browser, ["Priya", "Sam"]);
    const priya = session.participants[0]!;
    const sam = session.participants[1]!;
    try {
      await centreOn(priya.page, CLUSTER);
      await centreOn(sam.page, CLUSTER);
      await armPen(priya.page);

      const path = underlinePath(120);
      await pressPen(priya.page, path[0]!);
      for (const point of path.slice(1, 40)) await movePen(priya.page, point, 2);

      // Mid-drag: neither screen has a stroke. This is the assertion that must hold.
      expect(await strokeCount(priya.page)).toBe(0);
      expect(await strokeCount(sam.page)).toBe(0);

      for (const point of path.slice(40, 100)) await movePen(priya.page, point, 2);
      expect(await strokeCount(sam.page)).toBe(0);

      await releasePen(priya.page, path[path.length - 1]!);

      // The finished stroke travels; only its arrival time is measured, not asserted.
      await expectEventually("pen.stroke → Sam sees the finished stroke", async () => (await strokeCount(sam.page)) === 1);

      expect(await strokeCount(priya.page)).toBe(1);
      const forPriya = await newStrokeSince(priya.page, []);
      const forSam = await newStrokeSince(sam.page, []);
      // The same line for both: same colour, same thickness, same box in board units.
      expect(forSam.color).toBe(forPriya.color);
      expect(forSam.thickness).toBe(forPriya.thickness);
      expect(forSam.x).toBeCloseTo(forPriya.x, 0);
      expect(forSam.y).toBeCloseTo(forPriya.y, 0);
      expect(forSam.width).toBeCloseTo(forPriya.width, 0);
      expect(forSam.height).toBeCloseTo(forPriya.height, 0);
      // It is Sam's board state too, not only Sam's screen.
      expect((await roomObjects(session.boardId, 1)).filter((object) => object.type === "stroke")).toHaveLength(1);

      await expectNoProblems(session.participants);
    } finally {
      await session.close();
    }
    reportLatencies();
  });

  test("TC-19 the wheel pans while the pen is armed, and a drag starting on a sticky draws over it", async ({ browser }) => {
    const boardId = await createBoard();
    await writeBoard(boardId, (doc) => {
      seedNote(doc, 0, 0, "yellow", "Keep this");
    });
    const priya = await openParticipant(browser, "Priya", boardId);
    try {
      await expectNotes(priya, 1);
      await centreOn(priya.page, { x: 100, y: 80 });
      await armPen(priya.page);

      // `board.navigation` still belongs to the board: the wheel pans, it does not zoom.
      const before = await renderedCamera(priya.page);
      const centre = await boardCentre(priya.page);
      await priya.page.mouse.move(centre.x, centre.y);
      await priya.page.mouse.wheel(0, -260);
      await settle(priya.page);
      const after = await renderedCamera(priya.page);
      expect(after.zoom).toBeCloseTo(before.zoom, 6);
      expect(Math.abs(after.y - before.y)).toBeGreaterThan(100);

      // A press on a sticky note with the pen armed draws over it: the note stays put,
      // and the pen claims the press before the note can be dragged or selected.
      const noteBefore = (await notes(priya.page))[0]!;
      const noteWorld = await worldOf(priya.page, noteBefore);
      await pressPen(priya.page, { x: noteWorld.x + 10, y: noteWorld.y + 10 });
      await movePen(priya.page, { x: noteWorld.x + 60, y: noteWorld.y + 50 }, 4);
      await movePen(priya.page, { x: noteWorld.x + 120, y: noteWorld.y + 20 }, 4);
      await releasePen(priya.page, { x: noteWorld.x + 160, y: noteWorld.y + 60 });

      expect(await strokeCount(priya.page)).toBe(1);
      const moved = await worldOf(priya.page, (await notes(priya.page))[0]!);
      expect(moved.x).toBeCloseTo(noteWorld.x, 6);
      expect(moved.y).toBeCloseTo(noteWorld.y, 6);
      expect(await selectedIds(priya.page)).toEqual([]);
      expect((await notes(priya.page))[0]!.text).toBe("Keep this");

      await expectNoProblems([priya]);
    } finally {
      await priya.context.close();
    }
  });
});

test.describe("tidy up", () => {
  test("TC-20 select the line, resize it in proportion, move it, delete it", async ({ browser }) => {
    const session = await openSession(browser, ["Priya", "Sam"]);
    const priya = session.participants[0]!;
    const sam = session.participants[1]!;
    try {
      await centreOn(priya.page, CLUSTER);
      await centreOn(sam.page, CLUSTER);

      await armPen(priya.page);
      const beforeLoop = await strokeIds(priya.page);
      await drawStroke(priya.page, LOOP, { steps: 2 });
      const loop = await newStrokeSince(priya.page, beforeLoop);
      await choosePen(priya.page, { color: "blue" });
      const beforeUnderline = await strokeIds(priya.page);
      await drawStroke(priya.page, underlinePath(60), { steps: 2 });
      const underline = await newStrokeSince(priya.page, beforeUnderline);
      await leavePen(priya.page);

      expect(loop.points).toBeGreaterThan(20);
      expect(underline.color).toBe("blue");
      expect(await strokes(priya.page)).toHaveLength(2);

      await expectEventually("pen.stroke → Sam", async () => (await strokeCount(sam.page)) === 2);
      // Selection is local (story 5): Sam has none of it.
      expect(await selectedIds(sam.page)).toEqual([]);

      // `pen.select`: a click on the line — the first point of the rendered path,
      // which is a point the simplification kept — selects the stroke.
      const onTheLine = pathStart(loop);
      const at = await screenOf(priya.page, onTheLine);
      await priya.page.mouse.click(at.x, at.y);
      await settle(priya.page);
      expect(await selectedIds(priya.page)).toEqual([loop.id]);
      expect(await strokeById(priya.page, loop.id)).toMatchObject({ selected: true });

      // A click in the middle of the loop — inside its box, more than a hundred board
      // units from its line — does not select it (`pen.select`).
      const offTheLine = await screenOf(priya.page, {
        x: loop.x + loop.width / 2,
        y: loop.y + loop.height / 2,
      });
      await priya.page.mouse.click(offTheLine.x, offTheLine.y);
      await settle(priya.page);
      expect(await selectedIds(priya.page)).toEqual([]);

      // Re-select, then move it by grabbing the line at a point well away from the
      // selection handles — a point on the ring's lower-right arc. The whole stroke
      // moves; its size does not.
      await priya.page.mouse.click(at.x, at.y);
      await settle(priya.page);
      expect(await selectedIds(priya.page)).toEqual([loop.id]);
      const beforeMove = await strokeById(priya.page, loop.id);
      const onTheArc = LOOP[Math.floor(LOOP.length / 8)]!;
      const grab = await screenOf(priya.page, onTheArc);
      await dragObjectBy(priya.page, loop.id, { x: 80, y: 50 }, { grab, steps: 12 });
      const moved = await strokeById(priya.page, loop.id);
      expect(moved.x).toBeCloseTo(beforeMove.x + 80, 0);
      expect(moved.y).toBeCloseTo(beforeMove.y + 50, 0);
      expect(moved.width).toBeCloseTo(beforeMove.width, 0);
      expect(moved.height).toBeCloseTo(beforeMove.height, 0);

      // Resize from a corner handle: the proportions are preserved and the thickness
      // is untouched (`pen.resize`).
      const before = await strokeById(priya.page, loop.id);
      await dragHandleBy(priya.page, "nw", { x: -60, y: -40 }, { steps: 12 });
      const resized = await strokeById(priya.page, loop.id);
      expect(resized.width).toBeGreaterThan(before.width);
      expect(resized.height).toBeGreaterThan(before.height);
      const ratioBefore = before.width / before.height;
      const ratioAfter = resized.width / resized.height;
      expect(Math.abs(ratioAfter / ratioBefore - 1)).toBeLessThan(0.01);
      expect(resized.lineWidth).toBeCloseTo(before.lineWidth, 6);
      expect(resized.thickness).toBe(before.thickness);
      // The corner opposite the one that was dragged stayed where it was (to within
      // the sub-pixel rounding of a box), which is what "in proportion" means here:
      // the drawing scaled about that corner.
      expect(Math.abs(resized.x + resized.width - (before.x + before.width))).toBeLessThan(3);
      expect(Math.abs(resized.y + resized.height - (before.y + before.height))).toBeLessThan(3);
      expect(resized.x).toBeLessThan(before.x);
      expect(resized.y).toBeLessThan(before.y);

      // Delete: gone for both, and the selection is cleared.
      await pressKeys(priya.page, "Delete");
      await expectEventually("pen.delete → Sam", async () => (await strokeCount(sam.page)) === 1);
      expect(await strokeCount(priya.page)).toBe(1);
      expect(await selectedIds(priya.page)).toEqual([]);
      expect((await roomObjects(session.boardId, 1)).filter((object) => object.type === "stroke")).toHaveLength(1);

      await expectNoProblems(session.participants);
    } finally {
      await session.close();
    }
  });
});
