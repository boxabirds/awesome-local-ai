import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { deleteObject, snapshot } from "../../src/shared/board-model";
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from "../../src/shared/config";
import { zoomPercent } from "../../src/client/canvas/camera";
import {
  camera,
  clickEmptyBoard,
  countUpdates,
  createNoteAt,
  dblclick,
  firstNote,
  gridEl,
  hasEditor,
  keydown,
  keydownOnFocused,
  noteAt,
  noteCentreOnScreen,
  noteId,
  notePosition,
  notes,
  pointer,
  pressNote,
  renderBoard,
  settle,
  setCamera,
  textOf,
  worldEl,
} from "./helpers/board";

/**
 * sticky.interaction, ui-component level: select, drag to move, keyboard delete,
 * and the cases where the note disappears mid-interaction.
 */
describe("StickyNote interaction", () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    renderBoard(doc);
  });

  it("TC-18: a press without moving selects the note and shows its toolbar", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    clickEmptyBoard();
    await settle();

    const note = firstNote();
    expect(note.dataset.selected).toBe("false");
    expect(screen.queryByTestId("note-toolbar")).toBeNull();

    const before = notePosition(note);
    const updates = await countUpdates(doc, async () => {
      pressNote(note);
      await settle();
    });

    expect(firstNote().dataset.selected).toBe("true");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
    // Selection is view state: nothing was written to the shared document.
    expect(updates).toBe(0);
    expect(notePosition(firstNote())).toEqual(before);
  });

  it("TC-19: a 2px press still selects and never moves the note", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    await settle();

    const note = firstNote();
    const before = notePosition(note);
    const point = noteCentreOnScreen(note);

    const updates = await countUpdates(doc, async () => {
      pointer("pointerdown", note, point.x, point.y);
      pointer("pointermove", note, point.x + DRAG_THRESHOLD_PX - 1, point.y);
      await settle();
      pointer("pointerup", note, point.x + DRAG_THRESHOLD_PX - 1, point.y);
      await settle();
    });

    expect(updates).toBe(0);
    expect(notePosition(firstNote())).toEqual(before);
    expect(firstNote().dataset.selected).toBe("true");
    expect(snapshot(doc)[0].x).toBeCloseTo(before.x, 9);
  });

  it("TC-20: dragging a note moves the note, not the board", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    await settle();

    const camBefore = camera();
    const gridBefore = gridEl().style.backgroundPosition;
    const worldBefore = worldEl().style.transform;

    const note = firstNote();
    const before = notePosition(note);
    const point = noteCentreOnScreen(note);

    pointer("pointerdown", note, point.x, point.y);
    pointer("pointermove", note, point.x + 60, point.y + 25);
    await settle();
    pointer("pointermove", note, point.x + 90, point.y + 40);
    await settle();
    pointer("pointerup", note, point.x + 90, point.y + 40);
    await settle();

    const after = notePosition(firstNote());
    expect(after.x).toBeCloseTo(before.x + 90, 6);
    expect(after.y).toBeCloseTo(before.y + 40, 6);
    expect(camera()).toEqual(camBefore);
    expect(gridEl().style.backgroundPosition).toBe(gridBefore);
    expect(worldEl().style.transform).toBe(worldBefore);
    expect(firstNote().dataset.selected).toBe("true");
  });

  it("drag geometry divides the screen delta by zoom (100%, 50%, 200%)", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    await settle();

    for (const zoom of [1, 0.5, 2]) {
      setCamera({ zoom });
      await settle();
      expect(zoomPercent(camera())).toBe(Math.round(zoom * 100));

      const note = firstNote();
      const before = notePosition(note);
      const point = noteCentreOnScreen(note);

      pointer("pointerdown", note, point.x, point.y);
      pointer("pointermove", note, point.x + 100, point.y + 50);
      await settle();
      pointer("pointerup", note, point.x + 100, point.y + 50);
      await settle();

      const after = notePosition(firstNote());
      expect(after.x).toBeCloseTo(before.x + 100 / zoom, 6);
      expect(after.y).toBeCloseTo(before.y + 50 / zoom, 6);
      // The note's on-screen centre ends up under the pointer.
      expect(noteCentreOnScreen(firstNote()).x).toBeCloseTo(point.x + 100, 6);
      expect(noteCentreOnScreen(firstNote()).y).toBeCloseTo(point.y + 50, 6);
    }
  });

  it("a dragged note is drawn above the notes it overlaps (bringToFront once)", async () => {
    createNoteAt({ x: 300, y: 300 });
    await settle();
    keydownOnFocused("Escape");
    createNoteAt({ x: 700, y: 500 });
    await settle();
    keydownOnFocused("Escape");
    await settle();

    expect(notes()).toHaveLength(2);
    const dragged = noteAt(0);
    expect(snapshot(doc)[0].id).toBe(noteId(dragged));

    const point = noteCentreOnScreen(dragged);
    pointer("pointerdown", dragged, point.x, point.y);
    pointer("pointermove", dragged, point.x + 300, point.y + 150);
    await settle();
    pointer("pointermove", dragged, point.x + 320, point.y + 160);
    await settle();
    pointer("pointerup", dragged, point.x + 320, point.y + 160);
    await settle();

    const stacked = snapshot(doc);
    expect(stacked[1].id).toBe(noteId(dragged));
    // Stacking follows z through z-index (DOM order stays stable on purpose).
    expect(dragged.style.zIndex).toBe(String(stacked[1].z));
    const zValues = notes().map((el) => Number(el.style.zIndex));
    expect(Math.max(...zValues)).toBe(Number(dragged.style.zIndex));
  });

  it("TC-21: a cancelled drag keeps the last applied position and selects the note", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    await settle();

    const note = firstNote();
    const before = notePosition(note);
    const point = noteCentreOnScreen(note);

    pointer("pointerdown", note, point.x, point.y);
    pointer("pointermove", note, point.x + 70, point.y + 35);
    await settle();
    const applied = snapshot(doc)[0];
    expect(applied.x).toBeCloseTo(before.x + 70, 6);

    pointer("pointercancel", note, point.x + 70, point.y + 35);
    await settle();
    // A move that was in flight when the drag was cancelled is not applied.
    pointer("pointermove", note, point.x + 400, point.y + 400);
    await settle();

    const kept = notePosition(firstNote());
    expect(kept.x).toBeCloseTo(applied.x, 6);
    expect(kept.y).toBeCloseTo(applied.y, 6);
    expect(firstNote().dataset.selected).toBe("true");
  });

  it("TC-22: a click on empty board space clears the selection and the toolbar", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    await settle();
    expect(firstNote().dataset.selected).toBe("true");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    clickEmptyBoard(120, 120);
    await settle();

    expect(firstNote().dataset.selected).toBe("false");
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("a press on a note does not clear a selection made on another note", async () => {
    createNoteAt({ x: 300, y: 300 });
    await settle();
    keydownOnFocused("Escape");
    createNoteAt({ x: 800, y: 500 });
    await settle();
    keydownOnFocused("Escape");
    await settle();

    pressNote(noteAt(0));
    await settle();
    expect(noteAt(0).dataset.selected).toBe("true");

    // Pressing the other note moves the selection instead of clearing it.
    pressNote(noteAt(1));
    await settle();
    const selected = notes().filter((el) => el.dataset.selected === "true");
    expect(selected.map((el) => noteId(el))).toEqual([noteId(noteAt(1))]);
  });

  it("TC-25: Delete removes the selected note (separate run: Backspace does too)", async () => {
    for (const key of ["Delete", "Backspace"]) {
      cleanup();
      const local = new Y.Doc();
      renderBoard(local);
      createNoteAt({ x: 600, y: 400 });
      await settle();
      keydownOnFocused("Escape");
      await settle();
      expect(notes()).toHaveLength(1);

      const event = keydown(key);
      await settle();

      expect(event.defaultPrevented).toBe(true);
      expect(notes()).toHaveLength(0);
      expect(snapshot(local)).toHaveLength(0);
    }
  });

  it("TC-35: double-clicking an existing note edits it instead of creating one", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    await settle();

    const note = firstNote();
    const point = noteCentreOnScreen(note);
    dblclick(note, point.x, point.y);
    await settle();

    expect(notes()).toHaveLength(1);
    expect(snapshot(doc)).toHaveLength(1);
    expect(firstNote().dataset.editing).toBe("true");
    expect(hasEditor()).toBe(true);
    expect(notePosition(firstNote())).toEqual(notePosition(note));
  });

  it("TC-36: Enter and Delete with nothing selected do nothing", async () => {
    const enter = keydown("Enter");
    const del = keydown("Delete");
    const backspace = keydown("Backspace");
    await settle();

    expect(enter.defaultPrevented).toBe(false);
    expect(del.defaultPrevented).toBe(false);
    expect(backspace.defaultPrevented).toBe(false);
    expect(notes()).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(hasEditor()).toBe(false);
  });

  it("TC-37: a note deleted mid-drag ends the interaction silently", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    await settle();

    const note = firstNote();
    const id = noteId(note);
    const point = noteCentreOnScreen(note);

    pointer("pointerdown", note, point.x, point.y);
    pointer("pointermove", note, point.x + 60, point.y + 60);
    await settle();

    deleteObject(doc, id);
    await settle();

    // Further pointer events must not throw and must not re-create the note.
    pointer("pointermove", note, point.x + 140, point.y + 140);
    await settle();
    pointer("pointerup", note, point.x + 140, point.y + 140);
    await settle();

    expect(notes()).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it("TC-37: a note deleted while editing is not recreated by the editor leaving", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByTestId("sticky-note-textarea"), "half written");
    await settle();

    const id = noteId(firstNote());
    deleteObject(doc, id);
    await settle();

    expect(hasEditor()).toBe(false);
    expect(notes()).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it("a note keeps its board-unit size while the camera zooms", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    await settle();

    for (const zoom of [0.5, 1, 2]) {
      setCamera({ zoom });
      await settle();
      const note = firstNote();
      expect(note.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
      expect(note.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
      // The world layer carries the zoom, so notes scale with the board.
      expect(worldEl().style.transform.startsWith(`scale(${zoom})`)).toBe(true);
    }
  });

  it("notes render in stacking order (z, then id)", async () => {
    createNoteAt({ x: 200, y: 200 });
    await settle();
    keydownOnFocused("Escape");
    createNoteAt({ x: 400, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    createNoteAt({ x: 600, y: 600 });
    await settle();
    keydownOnFocused("Escape");
    await settle();

    expect(notes()).toHaveLength(3);
    const stacked = snapshot(doc);
    expect(stacked.map((note) => note.z)).toEqual([1, 2, 3]);
    // Stacking is expressed with z-index so DOM order can stay stable: moving a
    // note's node while it is being dragged cancels pointer capture.
    const byZ = [...notes()].sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex));
    expect(byZ.map((el) => noteId(el))).toEqual(stacked.map((note) => note.id));
    expect(textOf(doc, noteId(noteAt(0)))).toBe("");
  });
});
