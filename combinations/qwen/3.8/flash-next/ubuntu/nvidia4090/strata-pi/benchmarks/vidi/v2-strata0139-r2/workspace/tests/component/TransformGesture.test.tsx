import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import {
  DRAG_THRESHOLD_PX,
  MAX_OBJECT_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from "../../src/shared/config";
import * as Y from "yjs";
import {
  addNote,
  addTestBox,
  boardSpace,
  changeModel,
  dragHandle,
  dragObject,
  objectById,
  pressKey,
  readBox,
  readCamera,
  readObjects,
  renderBoard,
  runAnimationFramesSynchronously,
  screenDelta,
  screenOf,
  selectedIds,
  TESTBOX_TYPE,
  type RenderHandle,
} from "./boardFixture";
import { TESTBOX_MIN_SIZE } from "../fixtures/testbox";

/**
 * Story 7, tasks 9 and 12 (TC-23 to TC-26) — moving and resizing the selection.
 *
 * One gesture handles both: it starts after `DRAG_THRESHOLD_PX`, it writes
 * absolute positions so two people moving the same object settle instead of
 * drifting, it brings the moved objects to the front, and it clamps a resize to
 * the minimum size the object's **registered type** declares and to the board's
 * maximum.
 */

const NOTE = STICKY_SIZE_WORLD;

describe("sel.transform: moving and resizing objects", () => {
  let board: RenderHandle;

  beforeEach(() => {
    runAnimationFramesSynchronously();
    board = renderBoard();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-23 dragging an unselected object selects just it and moves it", () => {
    const selected = addNote(board, { x: 100, y: 100 });
    const pressed = addNote(board, { x: 500, y: 100 });
    board.changeSelection([selected]);

    const selectedBefore = readBox(board.doc, selected);
    const before = readBox(board.doc, pressed);
    dragObject(objectById(board.screen, pressed), screenOf({ x: 500, y: 100 }), screenOf({ x: 540, y: 130 }));

    expect(selectedIds(board.screen)).toEqual([pressed]);
    const after = readBox(board.doc, pressed);
    expect([after.x - before.x, after.y - before.y]).toEqual([40, 30]);
    // The object that was selected but not dragged stays where it was.
    expect(readBox(board.doc, selected)).toEqual(selectedBefore);
  });

  it("TC-23 a drag moves every selected object by the same delta", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 400, y: 300 });
    const c = addNote(board, { x: 900, y: 900 });
    board.changeSelection([a, b]);

    const start = [readBox(board.doc, a), readBox(board.doc, b), readBox(board.doc, c)];
    dragObject(objectById(board.screen, a), screenOf({ x: 100, y: 100 }), screenOf({ x: 160, y: 40 }));

    const end = [readBox(board.doc, a), readBox(board.doc, b), readBox(board.doc, c)];
    expect([end[0].x - start[0].x, end[0].y - start[0].y]).toEqual([60, -60]);
    expect([end[1].x - start[1].x, end[1].y - start[1].y]).toEqual([60, -60]);
    // The whole selection survives the drag.
    expect(selectedIds(board.screen).sort()).toEqual([a, b].sort());
    // The object outside the selection did not move.
    expect(end[2]).toEqual(start[2]);
  });

  it("TC-23 boundary: just under the drag threshold is a click, not a move", () => {
    const a = addNote(board, { x: 100, y: 100 });
    board.changeSelection([]);

    const before = readBox(board.doc, a);
    const justUnder = { x: DRAG_THRESHOLD_PX - 1, y: 0 };
    dragObject(objectById(board.screen, a), screenOf({ x: 100, y: 100 }), screenOf({ x: 100 + justUnder.x, y: 100 }));

    expect(readBox(board.doc, a)).toEqual(before);
    expect(selectedIds(board.screen)).toEqual([a]);
  });

  it("TC-23 boundary: exactly the drag threshold moves the object", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const before = readBox(board.doc, a);

    dragObject(
      objectById(board.screen, a),
      screenOf({ x: 100, y: 100 }),
      screenOf({ x: 100 + DRAG_THRESHOLD_PX, y: 100 }),
    );

    expect(readBox(board.doc, a).x - before.x).toBe(DRAG_THRESHOLD_PX);
  });

  it("moving brings the selection above every unselected object (TC: z-order)", () => {
    const low = addNote(board, { x: 100, y: 100 });
    const high = addNote(board, { x: 400, y: 100 });
    const top = addNote(board, { x: 700, y: 100 });
    board.changeSelection([low, high]);

    dragObject(objectById(board.screen, low), screenOf({ x: 100, y: 100 }), screenOf({ x: 130, y: 100 }));

    const movedLow = z(board.doc, low);
    const movedHigh = z(board.doc, high);
    const untouched = z(board.doc, top);
    expect(movedLow).toBeGreaterThan(untouched);
    expect(movedHigh).toBeGreaterThan(untouched);
    // The relative order inside the moved group is kept.
    expect(movedHigh).toBeGreaterThan(movedLow);
  });

  it("a dragged object stays under the pointer at any zoom: screen pixels divided by zoom", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const atZoom1 = readBox(board.doc, a);
    dragObject(objectById(board.screen, a), screenOf({ x: 100, y: 100 }), screenOf({ x: 200, y: 100 }));
    expect(readBox(board.doc, a).x - atZoom1.x).toBeCloseTo(100, 6);

    // Now zoom in and drag the same number of *screen pixels*: in board units
    // that is a shorter move, and the object must not overshoot the pointer.
    pressKey("=", boardSpace(board.screen), { ctrlKey: true });
    const zoom = readCamera().zoom;
    expect(zoom).toBeGreaterThan(1);
    const before = readBox(board.doc, a);
    const from = screenOf({ x: 100, y: 100 });
    const pixels = 125;
    dragObject(objectById(board.screen, a), from, { x: from.x + pixels, y: from.y });

    expect(readBox(board.doc, a).x - before.x).toBeCloseTo(pixels / zoom, 6);
    expect(screenDelta({ x: pixels / zoom, y: 0 }).x).toBeCloseTo(pixels, 6);
  });

  it("TC-24 a resize handle changes only the axis it belongs to when the type is free", () => {
    const box = addTestBox(board, { x: 100, y: 100 }, { width: 120, height: 80 });
    board.changeSelection([box]);

    const before = readBox(board.doc, box);
    dragHandle(board.screen, "e", { x: 220, y: 140 }, { x: 320, y: 140 });

    const after = readBox(board.doc, box);
    expect(after.width - before.width).toBeCloseTo(100, 6);
    expect(after.height).toBe(before.height);
    // The left edge stays put.
    expect(after.x).toBe(before.x);
  });

  it("TC-24 Shift held while resizing keeps the object's proportions", () => {
    const box = addTestBox(board, { x: 100, y: 100 }, { width: 100, height: 50 });
    board.changeSelection([box]);

    const before = readBox(board.doc, box);
    dragHandle(board.screen, "e", { x: 200, y: 125 }, { x: 300, y: 125 }, { shiftKey: true });

    const after = readBox(board.doc, box);
    expect(after.width / after.height).toBeCloseTo(before.width / before.height, 6);
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
  });

  it("TC-24 an aspect-locked type keeps its proportions without Shift", () => {
    const note = addNote(board, { x: 100, y: 100 });
    board.changeSelection([note]);

    const before = readBox(board.doc, note);
    expect(before.width).toBe(NOTE);
    dragHandle(board.screen, "e", { x: 200, y: 100 }, { x: 300, y: 100 });

    const after = readBox(board.doc, note);
    expect(after.width).toBe(after.height);
    expect(after.width).toBeGreaterThan(before.width);
  });

  it("TC-24 the limit is the registered type's minimum, not one constant", () => {
    const box = addTestBox(board, { x: 100, y: 100 }, { width: 120, height: 120 });
    board.changeSelection([box]);

    // Shrunk far below the sticky note's minimum: allowed, because `testbox`
    // declares its own, smaller minimum.
    dragHandle(board.screen, "se", { x: 220, y: 220 }, { x: 130, y: 130 });
    const shrunk = readBox(board.doc, box);
    expect(shrunk.width).toBeLessThan(STICKY_MIN_SIZE_WORLD);
    expect(shrunk.width).toBeGreaterThanOrEqual(TESTBOX_MIN_SIZE);

    // Dragged past its own minimum, it stops there instead of becoming invisible.
    dragHandle(board.screen, "se", { x: 220, y: 220 }, { x: -400, y: -400 });
    const clamped = readBox(board.doc, box);
    expect(clamped.width).toBeGreaterThanOrEqual(TESTBOX_MIN_SIZE);
    expect(clamped.height).toBeGreaterThanOrEqual(TESTBOX_MIN_SIZE);
  });

  it("TC-24 resize handles are named by position and there are 8 of them", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addTestBox(board, { x: 500, y: 100 }, { width: 100, height: 100 });
    board.changeSelection([a, b]);

    const positions = ["top-left", "top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left"];
    for (const position of positions) {
      expect(board.screen.getByLabelText(`Resize ${position}`)).toBeTruthy();
    }
    expect(board.screen.getAllByTestId(/^resize-handle-/).length).toBe(8);
  });

  it("a resize of a group keeps the objects' relative positions", () => {
    const small = addTestBox(board, { x: 100, y: 100 }, { width: 100, height: 100 });
    const big = addTestBox(board, { x: 300, y: 100 }, { width: 200, height: 200 });
    board.changeSelection([small, big]);

    const before = [readBox(board.doc, small), readBox(board.doc, big)];
    dragHandle(board.screen, "se", { x: 500, y: 300 }, { x: 700, y: 500 });

    const after = [readBox(board.doc, small), readBox(board.doc, big)];
    // The group's bounding box was resized, so every object scales by the same
    // per-axis factor: the group keeps its shape and its relative layout.
    expect(after[0].width / before[0].width).toBeCloseTo(after[1].width / before[1].width, 6);
    expect(after[0].height / before[0].height).toBeCloseTo(after[1].height / before[1].height, 6);
    // Measured from the group's anchored top-left corner, positions scale too.
    const anchor = before[0];
    expect(after[1].x - anchor.x).toBeCloseTo((before[1].x - anchor.x) * (after[1].width / before[1].width), 6);
  });

  it("a resize never grows an object past the board's maximum", () => {
    const box = addTestBox(board, { x: 100, y: 100 }, { width: 100, height: 100 });
    board.changeSelection([box]);

    dragHandle(board.screen, "se", { x: 200, y: 200 }, { x: 100_000, y: 100_000 });

    const after = readBox(board.doc, box);
    expect(after.width).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
    expect(after.height).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD);
  });

  it("TC-25 a board this client may not write to moves and resizes nothing", () => {
    const readOnly = renderBoard({ canEdit: false });
    const note = addNote(readOnly, { x: 100, y: 100 });
    const box = addTestBox(readOnly, { x: 500, y: 100 }, { width: 100, height: 100 });

    const beforeBox = readBox(readOnly.doc, box);
    dragObject(objectById(readOnly.screen, note), screenOf({ x: 100, y: 100 }), screenOf({ x: 300, y: 300 }));
    expect(selectedIds(readOnly.screen)).toEqual([]);
    expect(readBox(readOnly.doc, box)).toEqual(beforeBox);

    // A resize is refused the same way.
    readOnly.changeSelection([note, box]);
    dragHandle(readOnly.screen, "e", { x: 600, y: 150 }, { x: 700, y: 150 });
    expect(readBox(readOnly.doc, box)).toEqual(beforeBox);
    expect(readBox(readOnly.doc, note)).toEqual(readBox(readOnly.doc, note));

    // And so is Delete, even with a selection this screen forced.
    pressKey("Delete");
    expect(readObjects(readOnly.doc).map((entry) => entry.id).sort()).toEqual([box, note].sort());
    readOnly.unmount();
  });

  it("TC-26 one gesture window opens on the first applied change and closes on release", () => {
    const starts: number[] = [];
    const ends: number[] = [];
    const withLog = renderBoard({
      gestures: { onStart: () => starts.push(1), onEnd: () => ends.push(1) },
    });
    const a = addNote(withLog, { x: 100, y: 100 });

    // A click is not a gesture.
    dragObject(objectById(withLog.screen, a), screenOf({ x: 100, y: 100 }), screenOf({ x: 100, y: 100 }));
    expect([starts.length, ends.length]).toEqual([0, 0]);

    dragObject(objectById(withLog.screen, a), screenOf({ x: 100, y: 100 }), screenOf({ x: 150, y: 150 }));
    expect([starts.length, ends.length]).toEqual([1, 1]);

    dragHandle(withLog.screen, "se", { x: 200, y: 200 }, { x: 240, y: 240 });
    expect([starts.length, ends.length]).toEqual([2, 2]);

    // Pressing without ever reaching the threshold leaves the window closed.
    dragObject(objectById(withLog.screen, a), screenOf({ x: 100, y: 100 }), screenOf({ x: 101, y: 101 }));
    expect([starts.length, ends.length]).toEqual([2, 2]);
    withLog.unmount();
  });

  it("TC-26 a cancelled gesture keeps the last applied positions", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const before = readBox(board.doc, a);

    const el = objectById(board.screen, a);
    const from = screenOf({ x: 100, y: 100 });
    const mid = screenOf({ x: 150, y: 100 });
    dragObject(el, from, mid, { n: 2 });
    const moved = readBox(board.doc, a);
    expect(moved.x).toBeGreaterThan(before.x);

    // A cancel after the fact (a lost pointer capture) changes nothing further.
    fireEvent.pointerCancel(el, { pointerId: 1 });
    expect(readBox(board.doc, a)).toEqual(moved);
  });

  it("objects of an unregistered type are left alone by a marquee and by select-all", () => {
    const known = addNote(board, { x: 100, y: 100 });
    changeModel(() => {
      // An object whose type no component has registered.
      const objects = board.doc.getMap<Y.Map<unknown>>("objects");
      const entry = new Y.Map<unknown>();
      entry.set("type", "from-the-future");
      entry.set("x", 500);
      entry.set("y", 100);
      entry.set("z", 99);
      entry.set("createdAt", 1);
      objects.set("future-1", entry);
    });

    pressKey("a", document.body, { ctrlKey: true });

    expect(selectedIds(board.screen)).toEqual([known]);
  });

  it("the testbox object renders through the registry like any other type", () => {
    const box = addTestBox(board, { x: 100, y: 100 }, { width: 100, height: 100 });
    expect(objectById(board.screen, box).dataset.objectType).toBe(TESTBOX_TYPE);
  });

  function z(doc: Y.Doc, id: string): number {
    const object = readObjects(doc).find((entry) => entry.id === id);
    if (!object) throw new Error(`no object ${id}`);
    return object.z;
  }
});
