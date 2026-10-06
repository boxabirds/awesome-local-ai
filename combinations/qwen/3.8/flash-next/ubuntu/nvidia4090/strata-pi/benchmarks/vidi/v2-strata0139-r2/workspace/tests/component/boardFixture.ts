import { act, fireEvent, render as renderInJsdom, type RenderResult } from "@testing-library/react";
import { createElement } from "react";
import { vi } from "vitest";
import * as Y from "yjs";
import {
  createSticky,
  getStickyText,
  objectBounds,
  snapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from "../../src/shared/board-model";
import { type StickyColor } from "../../src/shared/config";
import type { Handle, Rect } from "../../src/shared/geometry";
import { BoardHarness, BoardUnderTest, type HarnessHandle, type HarnessOverrides } from "../fixtures/boardHarness";
import type { SelectionApi } from "../../src/client/board/useSelection";
import type { UndoController } from "../../src/client/board/undo";
// Importing the fixture registers the `testbox` type exactly once, for every
// component test: selection, moving and resizing must work for it exactly as they
// do for a sticky note (`sel.all_types`).
import { TESTBOX_TYPE, createTestBox } from "../fixtures/testbox";

/**
 * Shared helpers for the component tests. Board state is asserted on the Y.Doc
 * (jsdom has no layout engine), and interaction state on the data attributes the
 * components expose.
 */

// Re-exported so tests do not import the library twice.
export { fireEvent, act } from "@testing-library/react";

export const NOTE_SELECTOR = '[data-testid="sticky-note"]';
/** Every board object, whatever its type. */
export const OBJECT_SELECTOR = '[data-note-id]';
export { TESTBOX_TYPE };

/** Creates a note (centred on `at`, as the model does) and optionally gives it text. */
export function newNote(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = "yellow",
  text = "",
): string {
  const id = createSticky(doc, at, color);
  if (typeof id !== "string") throw new Error("createSticky rejected the input");
  if (text) getStickyText(doc, id)?.insert(0, text);
  return id;
}

export function readNotes(doc: Y.Doc): StickySnapshot[] {
  return snapshot(doc) as StickySnapshot[];
}

export function noteOf(doc: Y.Doc, id: string): StickySnapshot {
  const note = readNotes(doc).find((entry) => entry.id === id);
  if (!note) throw new Error(`no note ${id} in the model`);
  return note;
}

export function noteElements(screen: RenderResult): HTMLElement[] {
  return Array.from(screen.container.querySelectorAll<HTMLElement>(NOTE_SELECTOR));
}

export function noteById(screen: RenderResult, id: string): HTMLElement {
  const el = screen.container.querySelector<HTMLElement>(`${NOTE_SELECTOR}[data-note-id="${id}"]`);
  if (!el) throw new Error(`no note element for ${id}`);
  return el;
}

export function objectElements(screen: RenderResult): HTMLElement[] {
  return Array.from(screen.container.querySelectorAll<HTMLElement>(OBJECT_SELECTOR));
}

/** Ids this screen shows as selected, in DOM order, whatever the object type. */
export function selectedIds(screen: RenderResult): string[] {
  return objectElements(screen)
    .filter((el) => el.dataset.selected === "true")
    .map((el) => el.dataset.noteId ?? "");
}

export function boardSpace(screen: RenderResult): HTMLElement {
  return screen.getByTestId("board-viewport");
}

export function pointer(
  name: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
  target: Element,
  x: number,
  y: number,
  shiftKey = false,
): void {
  fireEvent[name](target, {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: x,
    clientY: y,
    shiftKey,
  });
}

/** Press, move, release on one of the selection's resize handles. */
export function dragHandle(
  screen: RenderResult,
  handle: Handle,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { n?: number; shiftKey?: boolean } = {},
): void {
  const el = screen.container.querySelector<HTMLElement>(`[data-testid="resize-handle-${handle}"]`);
  if (!el) throw new Error(`no resize handle ${handle} on screen`);
  dragObject(el, from, to, options);
}

/** Drags a box across the board with Shift held: the selection rectangle. */
export function dragMarquee(
  screen: RenderResult,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { n?: number } = {},
): void {
  dragObject(boardSpace(screen), from, to, { ...options, shiftKey: true });
}

export function objectById(screen: RenderResult, id: string): HTMLElement {
  const el = screen.container.querySelector<HTMLElement>(`${OBJECT_SELECTOR}[data-note-id="${id}"]`);
  if (!el) throw new Error(`no object element for ${id}`);
  return el;
}

/** Press, optionally move `n` times, release. Positions are absolute screen pixels. */
export function dragObject(
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { n?: number; shiftKey?: boolean } = {},
): void {
  const steps = Math.max(1, options.n ?? 1);
  pointer("pointerDown", target, from.x, from.y, options.shiftKey);
  for (let step = 1; step <= steps; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    pointer("pointerMove", target, x, y, options.shiftKey);
  }
  pointer("pointerUp", target, to.x, to.y, options.shiftKey);
}

/** Press, move, release. Positions are absolute screen pixels. */
export function dragNote(
  screen: RenderResult,
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { n?: number; addMove?: boolean } = {},
): void {
  const el = noteById(screen, id);
  dragObject(el, from, to, { n: options.n });
  // `addMove` reproduces the story 2 helper exactly: one extra move event at the
  // end, so its throttle test still sees two queued frames collapsed into one.
  if (options.addMove) pointer("pointerMove", el, to.x, to.y);
}

export function selectNote(screen: RenderResult, id: string): void {
  dragNote(screen, id, { x: 100, y: 100 }, { x: 100, y: 100 });
}

export function pressKey(
  key: string,
  target: Element = document.body,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): boolean {
  // `false` means the board called `preventDefault`, which is what keeps the page
  // from scrolling and the browser from selecting the page's text.
  return fireEvent.keyDown(target, {
    key,
    code: key,
    shiftKey: modifiers.shiftKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  });
}

/**
 * Runs a direct model change through `act`, so React has re-rendered before
 * the next assertion.
 */
export function changeModel(mutate: () => void): void {
  act(mutate);
}

/** The camera, through story 1's test-only hook. */
export function readCamera(): { x: number; y: number; zoom: number } {
  const api = window.__vidi6;
  if (!api) throw new Error("window.__vidi6 test hook is not installed");
  return api.getCamera();
}

/**
 * The screen point a world point appears at with the camera on screen right
 * now. Board objects are positioned in world units, pointer events in screen
 * pixels, and the board starts centred on the origin.
 */
export function screenOf(point: { x: number; y: number }): { x: number; y: number } {
  const cam = readCamera();
  return { x: (point.x - cam.x) * cam.zoom, y: (point.y - cam.y) * cam.zoom };
}

/** The screen delta a world-unit delta appears as, right now. */
export function screenDelta(delta: { x: number; y: number }): { x: number; y: number } {
  const cam = readCamera();
  return { x: delta.x * cam.zoom, y: delta.y * cam.zoom };
}

/**
 * Makes the drag's animation-frame throttle synchronous, so a test can assert
 * on the model right after firing pointer events.
 */
export function runAnimationFramesSynchronously(): void {
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((): void => undefined);
}


// ---- mounting the board ---------------------------------------------------

export interface RenderOptions {
  /** Opt in to the `testbox` type (it is registered by importing the fixture). */
  register?: typeof TESTBOX_TYPE;
  /** A board this client may not write to (TC-25). */
  canEdit?: boolean;
  /** Props merged into one object component (TC-24). */
  extraProps?: Record<string, Record<string, unknown>>;
  /** Counts the gesture callbacks (TC-26). */
  gestures?: { onStart(): void; onEnd(): void };
  /** Story 8: hand the board a history of the test's choosing (a spy, usually). */
  undo?: UndoController;
}

export interface RenderHandle {
  doc: Y.Doc;
  screen: RenderResult;
  /** Overrides one object component's props and re-renders. */
  updateComponent(id: string, props: Record<string, unknown>): void;
  /** Sets this screen's selection directly (never by clicking). */
  changeSelection(ids: readonly string[]): void;
  /** The selection state of the board on screen. */
  selection(): SelectionApi;
  /** Story 8: this board's undo history (harness boards only). */
  undo(): UndoController;
  unmount(): void;
}

/** The board with the harness options; `render` is the plain one. */
export function renderBoard(options: RenderOptions = {}): RenderHandle {
  const doc = new Y.Doc();
  const overrides: { current: HarnessOverrides } = { current: { byId: { ...options.extraProps } } };
  const handleRef: { current: HarnessHandle | null } = { current: null };

  const screen = renderInJsdom(
    createElement(BoardHarness, {
      doc,
      canEdit: options.canEdit ?? true,
      overridesRef: overrides as never,
      handleRef: handleRef as never,
      gestures: options.gestures,
      undo: options.undo,
    }),
  );
  return handleFor(doc, screen, overrides, handleRef);
}

/** Adds a note to a mounted board and lets React catch up. */
export function addNote(
  board: RenderHandle,
  at: { x: number; y: number },
  color: StickyColor = "yellow",
  text = "",
): string {
  let id = "";
  changeModel(() => {
    id = newNote(board.doc, at, color, text);
  });
  return id;
}

/** Adds a `testbox` object to a mounted board and lets React catch up. */
export function addTestBox(
  board: RenderHandle,
  at: { x: number; y: number },
  size?: { width: number; height: number },
): string {
  let id = "";
  changeModel(() => {
    id = createTestBox(board.doc, at, size);
  });
  return id;
}

/** The real `App`, with an empty document. */
export function render(options: RenderOptions = {}): RenderHandle {
  const doc = new Y.Doc();
  const overrides: { current: HarnessOverrides } = { current: { byId: {} } };
  const handleRef: { current: HarnessHandle | null } = { current: null };
  void options.register;

  const screen = renderInJsdom(
    createElement(BoardUnderTest, {
      doc,
      canEdit: options.canEdit,
      overridesRef: overrides as never,
      handleRef: handleRef as never,
    }),
  );
  return handleFor(doc, screen, overrides, handleRef);
}

function handleFor(
  doc: Y.Doc,
  screen: RenderResult,
  overrides: { current: HarnessOverrides },
  handleRef: { current: HarnessHandle | null },
): RenderHandle {
  return {
    doc,
    screen,
    updateComponent(id, props) {
      overrides.current = { byId: { ...overrides.current.byId, [id]: { ...overrides.current.byId[id], ...props } } };
      act(() => {
        handleRef.current?.setOverrides(overrides.current.byId);
      });
    },
    changeSelection(ids) {
      const selection = handleRef.current?.selection();
      if (!selection) throw new Error("changeSelection needs the board harness (renderBoard)");
      act(() => {
        selection.setMany(ids, false);
      });
    },
    selection() {
      const selection = handleRef.current?.selection();
      if (!selection) throw new Error("this board does not expose its selection");
      return selection;
    },
    undo() {
      const controller = handleRef.current?.undo();
      if (!controller) throw new Error("undo needs the board harness (renderBoard)");
      return controller;
    },
    unmount: () => screen.unmount(),
  };
}

/** The board box of one object, from the document. */
export function readBox(doc: Y.Doc, id: string): Rect {
  const object = snapshot(doc).find((entry) => entry.id === id);
  if (!object) throw new Error(`no object ${id} in the model`);
  return objectBounds(object);
}

export function readObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  return snapshot(doc);
}

export function objectCount(doc: Y.Doc): number {
  return snapshot(doc).length;
}
