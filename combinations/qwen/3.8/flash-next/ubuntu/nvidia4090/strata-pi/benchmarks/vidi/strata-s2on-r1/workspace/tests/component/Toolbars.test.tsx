import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { snapshot } from "../../src/shared/board-model";
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from "../../src/shared/config";
import { screenToWorld } from "../../src/client/canvas/camera";
import { STICKY_NOTE_BUTTON_TOOLTIP } from "../../src/client/board/Toolbar";
import {
  camera,
  createNoteAt,
  expectedBackground,
  firstNote,
  hasEditor,
  keydownOnFocused,
  notePosition,
  notes,
  pointer,
  renderBoard,
  settle,
  setCamera,
  VIEWPORT,
} from "./helpers/board";

/**
 * sticky.toolbar, ui-component level: the Sticky note button, the colour
 * swatches and the delete button, including their accessible names.
 */
describe("toolbars: create, colour, delete", () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    renderBoard(doc);
  });

  async function createSelectedNote() {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    await settle();
  }

  it("TC-28: the Sticky note button creates one note centred on the visible board", async () => {
    const user = userEvent.setup({ delay: null });
    expect(notes()).toHaveLength(0);

    const button = screen.getByRole("button", { name: "Sticky note" });
    expect(button.getAttribute("title")).toBe(STICKY_NOTE_BUTTON_TOOLTIP);
    await user.click(button);
    await settle();

    expect(notes()).toHaveLength(1);
    const note = snapshot(doc)[0];
    const centre = screenToWorld(camera(), {
      x: VIEWPORT.width / 2,
      y: VIEWPORT.height / 2,
    });
    expect(note.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    expect(note.color).toBe("yellow");
    expect(note.text).toBe("");
    // Created on top of everything, and ready for typing straight away.
    expect(note.z).toBe(1);
    expect(firstNote().dataset.editing).toBe("true");
    expect(firstNote().dataset.selected).toBe("true");
    expect(hasEditor()).toBe(true);
  });

  it("TC-28b: the button works when the board is panned far away", async () => {
    const user = userEvent.setup({ delay: null });
    setCamera({ x: 12345.5, y: -9876.25, zoom: 1 });
    await settle();

    await user.click(screen.getByRole("button", { name: "Sticky note" }));
    await settle();

    const note = snapshot(doc)[0];
    const centre = screenToWorld(camera(), {
      x: VIEWPORT.width / 2,
      y: VIEWPORT.height / 2,
    });
    expect(note.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    // Screen position of the new note: the middle of the window.
    const onScreen = {
      x: (notePosition(firstNote()).x - camera().x) * camera().zoom,
      y: (notePosition(firstNote()).y - camera().y) * camera().zoom,
    };
    expect(onScreen.x).toBeCloseTo(VIEWPORT.width / 2 - STICKY_SIZE_WORLD / 2, 6);
    expect(onScreen.y).toBeCloseTo(VIEWPORT.height / 2 - STICKY_SIZE_WORLD / 2, 6);
  });

  it("the board toolbar is labelled and holds the Sticky note button", () => {
    const toolbar = screen.getByRole("toolbar", { name: "Board tools" });
    expect(toolbar.contains(screen.getByRole("button", { name: "Sticky note" }))).toBe(true);
  });

  it("TC-27: a colour swatch recolours the note and keeps it selected", async () => {
    const user = userEvent.setup({ delay: null });
    await createSelectedNote();
    const before = { ...snapshot(doc)[0] };

    await user.click(screen.getByRole("button", { name: "Pink colour" }));
    await settle();

    const after = snapshot(doc)[0];
    expect(after.color).toBe("pink");
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(firstNote().dataset.selected).toBe("true");
    expect(firstNote().style.background).toBe(expectedBackground(STICKY_COLORS.pink));
    expect(screen.getByRole("button", { name: "Pink colour" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("the note toolbar names every colour and shows six distinct swatches", async () => {
    await createSelectedNote();

    const group = screen.getByRole("group", { name: "Note tools" });
    const swatches = Array.from(group.querySelectorAll("button[data-color]"));
    expect(swatches).toHaveLength(6);
    const names = Object.keys(STICKY_COLORS) as StickyColor[];
    for (const name of names) {
      const label = `${name.charAt(0).toUpperCase()}${name.slice(1)} colour`;
      const button = screen.getByRole("button", { name: label });
      expect(button.style.background).toBe(expectedBackground(STICKY_COLORS[name]));
      expect(group.contains(button)).toBe(true);
    }
    const backgrounds = swatches.map((el) => (el as HTMLElement).style.background);
    expect(new Set(backgrounds).size).toBe(6);
    // Colour is not the only way to tell the swatches apart.
    expect(new Set(swatches.map((el) => el.getAttribute("aria-label"))).size).toBe(6);
  });

  it("TC-29: the delete button removes the note and clears the selection", async () => {
    const user = userEvent.setup({ delay: null });
    await createSelectedNote();
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete note" }));
    await settle();

    expect(notes()).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("the note toolbar is hidden while editing and while dragging", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    // Editing: selected but no toolbar.
    expect(firstNote().dataset.editing).toBe("true");
    expect(screen.queryByTestId("note-toolbar")).toBeNull();

    keydownOnFocused("Escape");
    await settle();
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    // Dragging: the toolbar is gone again.
    const note = firstNote();
    const point = {
      x: (notePosition(note).x - camera().x + STICKY_SIZE_WORLD / 2) * camera().zoom,
      y: (notePosition(note).y - camera().y + STICKY_SIZE_WORLD / 2) * camera().zoom,
    };
    pointer("pointerdown", note, point.x, point.y);
    pointer("pointermove", note, point.x + 40, point.y + 40);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
    await settle();
    pointer("pointerup", note, point.x + 40, point.y + 40);
    await settle();
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
  });

  it("a toolbar click does not clear the selection or move the camera", async () => {
    const user = userEvent.setup({ delay: null });
    await createSelectedNote();
    const camBefore = camera();

    await user.click(screen.getByRole("button", { name: "Violet colour" }));
    await settle();

    expect(firstNote().dataset.selected).toBe("true");
    expect(camera()).toEqual(camBefore);
    expect(snapshot(doc)[0].color).toBe("violet");
  });
});
