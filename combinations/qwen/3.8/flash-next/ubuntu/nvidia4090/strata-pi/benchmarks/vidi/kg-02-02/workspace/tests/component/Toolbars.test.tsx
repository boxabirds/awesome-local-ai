import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { snapshot } from "../../src/shared/board-model";
import { STICKY_COLORS, STICKY_SIZE_WORLD } from "../../src/shared/config";
import { screenToWorld } from "../../src/client/canvas/camera";
import { STICKY_NOTE_BUTTON_TOOLTIP } from "../../src/client/board/Toolbar";
import {
  addNoteAtOrigin,
  camera,
  clickNote,
  noteEl,
  noteElements,
  onlyNote,
  pointer,
  renderBoard,
  settle,
  VIEWPORT_SIZE,
  viewportEl,
} from "./helpers/notes";

/** jsdom reports colours as rgb(), the palette is hex: compare as parsed colours. */
function cssColor(value: string): string {
  const el = document.createElement("div");
  el.style.color = value;
  return el.style.color;
}

describe("toolbars", () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  function button(testId: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-testid='${testId}']`);
    if (!el) throw new Error(`${testId} is not rendered`);
    return el;
  }

  /** TC-27: a swatch changes only the colour. */
  it("TC-27 picking a swatch recolours the selected note and nothing else", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    clickNote(id);
    await settle();

    const before = onlyNote(doc);
    button("color-pink").click();
    await settle();

    const after = onlyNote(doc);
    expect(after.color).toBe("pink");
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(noteEl(id).dataset.selected).toBe("true");
    expect(cssColor(noteEl(id).style.background)).toBe(cssColor(STICKY_COLORS.pink));
    // The pressed swatch is marked as such for assistive technology.
    expect(button("color-pink").getAttribute("aria-pressed")).toBe("true");
    expect(button("color-yellow").getAttribute("aria-pressed")).toBe("false");
  });

  it("all six swatches are named and have no text colour names in the note", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    clickNote(id);
    await settle();

    const labels = ["Yellow", "Orange", "Green", "Blue", "Pink", "Violet"];
    for (const label of labels) {
      const swatch = document.querySelector<HTMLElement>(`[aria-label='${label} colour']`);
      expect(swatch).not.toBeNull();
    }

    const swatches = document.querySelectorAll<HTMLElement>("[data-testid^='color-']");
    expect(swatches).toHaveLength(6);
    const deleteButton = document.querySelector<HTMLElement>("[aria-label='Delete note']");
    expect(deleteButton).not.toBeNull();
    expect(button("delete-note").getAttribute("aria-label")).toBe("Delete note");
  });

  it("selecting a swatch of the current colour changes nothing", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    clickNote(id);
    await settle();
    const before = onlyNote(doc);

    button("color-yellow").click();
    await settle();

    expect(onlyNote(doc)).toEqual(before);
  });

  /** TC-28: the sticky note button creates one note at the centre of the view. */
  it("TC-28 the toolbar button creates a note in the middle of the visible board", async () => {
    renderBoard(doc);
    const centre = worldCentreOnScreen();

    button("create-sticky").click();
    await settle();

    const note = onlyNote(doc);
    expect(note.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    // It goes straight into editing with the caret, and is selected.
    expect(document.querySelector("[data-testid='sticky-editor']")).not.toBeNull();
    expect(noteEl(note.id).dataset.selected).toBe("true");
  });

  it("TC-28 the note button follows the board to wherever it has been panned", async () => {
    renderBoard(doc);

    const board = viewportEl();
    pointer("pointerdown", board, 600, 400);
    pointer("pointermove", board, 700, 400);
    pointer("pointerup", board, 700, 400);
    await settle();

    button("create-sticky").click();
    await settle();

    const centre = worldCentreOnScreen();
    const note = onlyNote(doc);
    expect(note.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    // Panning the board right moved the world point that is now at the centre.
    expect(centre.x).toBeLessThan(0);
  });

  it("the sticky note button states the double-click alternative", () => {
    renderBoard(doc);
    const el = button("create-sticky");
    expect(el.getAttribute("aria-label")).toBe("Sticky note");
    expect(el.getAttribute("title")).toBe(STICKY_NOTE_BUTTON_TOOLTIP);
    expect(el.textContent).toContain("Sticky note");
  });

  /** TC-29: the bin button deletes only that note and clears the selection. */
  it("TC-29 the bin button deletes the selected note", async () => {
    const kept = addNoteAtOrigin(doc);
    renderBoard(doc);
    const other = addNoteAtOrigin(doc);
    await settle();

    clickNote(other);
    await settle();
    expect(noteEl(other).dataset.selected).toBe("true");

    button("delete-note").click();
    await settle();

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.id).toBe(kept);
    expect(noteElements()).toHaveLength(1);
    expect(document.querySelector("[data-testid='note-toolbar']")).toBeNull();
    expect(noteEl(kept).dataset.selected).toBe("false");
  });

  /** Zoom must not distort note geometry: screen delta divided by zoom. */
  it("dragging at 200% zoom moves the note by screen delta / zoom", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    window.__vidi6!.setCamera({ ...camera(), zoom: 2 });
    await settle();
    const before = onlyNote(doc);

    const el = noteEl(id);
    pointer("pointerdown", el, 400, 400);
    pointer("pointermove", el, 420, 410);
    await settle();
    pointer("pointerup", el, 420, 410);
    await settle();

    const after = onlyNote(doc);
    expect(after.x).toBeCloseTo(before.x + 20 / 2, 6);
    expect(after.y).toBeCloseTo(before.y + 10 / 2, 6);
  });

  function worldCentreOnScreen(): { x: number; y: number } {
    return screenToWorld(camera(), {
      x: VIEWPORT_SIZE.width / 2,
      y: VIEWPORT_SIZE.height / 2,
    });
  }
});
