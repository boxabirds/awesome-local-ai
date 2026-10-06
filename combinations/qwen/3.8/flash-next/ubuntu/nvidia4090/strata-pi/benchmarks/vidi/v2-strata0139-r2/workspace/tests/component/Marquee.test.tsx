import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addNote,
  addTestBox,
  boardSpace,
  dragMarquee,
  dragObject,
  pointer,
  pressKey,
  readCamera,
  readNotes,
  renderBoard,
  screenOf,
  selectedIds,
  type RenderHandle,
} from "./boardFixture";

/**
 * Story 7, task 11 (TC-20 to TC-22) — Shift+drag selection.
 *
 * The rectangle is stored in board units, so what it selects does not depend on
 * the zoom or on where the board had been panned to. On release, everything lying
 * **entirely** inside it joins the selection; an object it merely clips is not
 * selected, and an empty rectangle changes nothing. A drag without Shift stays
 * the pan it was in story 1.
 */

describe("sel.marquee_ui: Shift+drag selection", () => {
  let board: RenderHandle;

  beforeEach(() => {
    board = renderBoard();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-20 Shift+drag around objects adds them to the selection", () => {
    const inside = addNote(board, { x: 100, y: 100 }); // box 0..200
    const half = addNote(board, { x: 400, y: 400 }); // box 300..500
    const outside = addNote(board, { x: 1200, y: 100 }); // box 1100..1300
    // Something already selected must survive: a marquee adds, it does not replace.
    board.changeSelection([outside]);

    dragMarquee(board.screen, screenOf({ x: -50, y: -50 }), screenOf({ x: 250, y: 250 }));

    expect(selectedIds(board.screen).sort()).toEqual([outside, inside].sort());
    expect(selectedIds(board.screen)).not.toContain(half);
  });

  it("the rectangle is drawn while dragging and gone afterwards", () => {
    const inside = addNote(board, { x: 100, y: 100 });
    const from = screenOf({ x: -50, y: -50 });
    const to = screenOf({ x: 250, y: 250 });

    press("pointerDown", from, true);
    press("pointerMove", to, true);
    // The rectangle is in board units, so its width is the distance dragged.
    expect(board.screen.getByTestId("marquee-rect").style.width).toBe("300px");

    press("pointerUp", to, true);
    expect(board.screen.queryByTestId("marquee-rect")).toBeNull();
    expect(selectedIds(board.screen)).toEqual([inside]);
  });

  it("TC-32 boundary: an object the rectangle clips is not selected", () => {
    const clipped = addNote(board, { x: 400, y: 400 }); // box 300..500
    const inside = addNote(board, { x: 100, y: 100 }); // box 0..200

    // The rectangle ends exactly on the clipped note's left edge: part of the
    // note is outside it, so the note is not enclosed and not selected.
    dragMarquee(board.screen, screenOf({ x: -50, y: -50 }), screenOf({ x: 300, y: 300 }));

    expect(selectedIds(board.screen)).toEqual([inside]);
    expect(selectedIds(board.screen)).not.toContain(clipped);
  });

  it("an empty rectangle leaves the selection exactly as it was", () => {
    const untouched = addNote(board, { x: 100, y: 100 });
    const selected = addNote(board, { x: 900, y: 900 });
    board.changeSelection([selected]);

    const at = screenOf({ x: -300, y: -300 });
    dragMarquee(board.screen, at, at);

    expect(selectedIds(board.screen)).toEqual([selected]);
    expect(selectedIds(board.screen)).not.toContain(untouched);
  });

  it("TC-21 a plain drag on empty space pans the board and never marquee-selects (negative)", () => {
    const before = readCamera();
    const selected = addNote(board, { x: 100, y: 100 });
    board.changeSelection([selected]);

    dragObject(
      boardSpace(board.screen),
      screenOf({ x: 0, y: 0 }),
      screenOf({ x: -200, y: -200 }),
    );

    const after = readCamera();
    expect(after.x).not.toBe(before.x);
    expect(after.y).not.toBe(before.y);
    expect(board.screen.queryByTestId("marquee-rect")).toBeNull();
    // Panning does not clear the selection either.
    expect(selectedIds(board.screen)).toEqual([selected]);
  });

  it("a marquee never pans the board", () => {
    const before = readCamera();

    dragMarquee(board.screen, screenOf({ x: -50, y: -50 }), screenOf({ x: 250, y: 250 }));

    const after = readCamera();
    expect([after.x, after.y, after.zoom]).toEqual([before.x, before.y, before.zoom]);
  });

  it("TC-22 pointercancel mid-marquee selects nothing (error path)", () => {
    addNote(board, { x: 100, y: 100 });
    const selected = addNote(board, { x: 900, y: 900 });
    board.changeSelection([selected]);

    const from = screenOf({ x: -50, y: -50 });
    const to = screenOf({ x: 250, y: 250 });
    press("pointerDown", from, true);
    press("pointerMove", to, true);
    press("pointerCancel", to, true);

    expect(board.screen.queryByTestId("marquee-rect")).toBeNull();
    expect(selectedIds(board.screen)).toEqual([selected]);
  });

  it("Escape during a marquee cancels the marquee and keeps the previous selection", () => {
    const covered = addNote(board, { x: 100, y: 100 });
    const selected = addNote(board, { x: 900, y: 900 });
    board.changeSelection([selected]);

    const from = screenOf({ x: -50, y: -50 });
    const to = screenOf({ x: 250, y: 250 });
    press("pointerDown", from, true);
    press("pointerMove", to, true);
    pressKey("Escape");

    expect(board.screen.queryByTestId("marquee-rect")).toBeNull();
    expect(selectedIds(board.screen)).toEqual([selected]);
    expect(selectedIds(board.screen)).not.toContain(covered);

    // And Escape again, with no marquee running, clears the selection.
    pressKey("Escape");
    expect(selectedIds(board.screen)).toEqual([]);
  });

  it("the marquee selects objects of every registered type", () => {
    const sticky = addNote(board, { x: 100, y: 100 });
    const box = addTestBox(board, { x: 100, y: 400 }, { width: 100, height: 60 });
    const outside = addNote(board, { x: 1400, y: 900 });

    dragMarquee(board.screen, screenOf({ x: -50, y: -50 }), screenOf({ x: 300, y: 500 }));

    expect(selectedIds(board.screen).sort()).toEqual([sticky, box].sort());
    expect(selectedIds(board.screen)).not.toContain(outside);
  });

  it("a marquee over empty region invents nothing", () => {
    const far = addNote(board, { x: 4000, y: 4000 });

    dragMarquee(board.screen, screenOf({ x: -50, y: -50 }), screenOf({ x: 200, y: 200 }));

    expect(selectedIds(board.screen)).toEqual([]);
    expect(selectedIds(board.screen)).not.toContain(far);
    expect(readNotes(board.doc).map((note) => note.id)).toEqual([far]);
  });

  /** One pointer event on the viewport element, with Shift held or not. */
  function press(
    name: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
    at: { x: number; y: number },
    shiftKey: boolean,
  ): void {
    pointer(name, boardSpace(board.screen), at.x, at.y, shiftKey);
  }
});
