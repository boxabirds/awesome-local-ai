import { act, render, screen } from "@testing-library/react";
import * as Y from "yjs";
import { getStickyText } from "../../../src/shared/board-model";
import { STICKY_SIZE_WORLD } from "../../../src/shared/config";
import { App } from "../../../src/client/App";
import type { Camera } from "../../../src/client/canvas/camera";

/**
 * Shared helpers for the story 2 component tests: the whole `App` is rendered
 * against a caller-owned Y.Doc, so a test can assert on the shared document and
 * on the DOM at the same time.
 */
export const VIEWPORT = { width: 1200, height: 800 };

export function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

export function camera(): Camera {
  const hook = window.__vidi6;
  if (!hook) throw new Error("window.__vidi6 test hook is not installed");
  return hook.getCamera();
}

export function setCamera(next: Partial<Camera>) {
  const current = camera();
  act(() => {
    window.__vidi6?.setCamera({ ...current, ...next });
  });
}

export function viewportEl(): HTMLElement {
  return screen.getByTestId("board-viewport");
}

export function worldEl(): HTMLElement {
  return screen.getByTestId("board-world");
}

export function gridEl(): HTMLElement {
  return screen.getByTestId("board-grid");
}

/** Renders the app with an explicit document. */
export function renderBoard(doc: Y.Doc) {
  setWindowSize(VIEWPORT.width, VIEWPORT.height);
  render(<App doc={doc} />);
}

/** Lets rAF-scheduled writes (drag moves) and React re-renders land. */
export async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

export function pointer(type: string, el: HTMLElement, x: number, y: number) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: x,
    clientY: y,
  });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

export function dblclick(el: HTMLElement, x: number, y: number) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
    );
  });
}

/** A window-level key press, as a real browser delivers it when nothing is focused. */
export function keydown(key: string) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
  window.dispatchEvent(event);
  return event;
}

/** A key press on the focused element, which then bubbles to the window. */
export function keydownOnFocused(key: string) {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

export function notes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".sticky-note"));
}

export function noteAt(index: number): HTMLElement {
  const list = notes();
  if (list.length <= index) throw new Error(`expected a note at index ${index}, found ${list.length}`);
  return list[index];
}

export function firstNote(): HTMLElement {
  const list = notes();
  if (list.length !== 1) throw new Error(`expected exactly one note, found ${list.length}`);
  return list[0];
}

export function noteId(el: HTMLElement): string {
  const id = el.dataset.noteId;
  if (!id) throw new Error("note element has no data-note-id");
  return id;
}

/** World position of a note, read from its inline style (board units). */
export function notePosition(el: HTMLElement): { x: number; y: number } {
  return { x: Number.parseFloat(el.style.left), y: Number.parseFloat(el.style.top) };
}

/** Screen point at the centre of a note, using the live camera. */
export function noteCentreOnScreen(el: HTMLElement): { x: number; y: number } {
  const cam = camera();
  const world = notePosition(el);
  return {
    x: (world.x - cam.x + STICKY_SIZE_WORLD / 2) * cam.zoom,
    y: (world.y - cam.y + STICKY_SIZE_WORLD / 2) * cam.zoom,
  };
}

/** A press and release on a note that stays well below the drag threshold. */
export function pressNote(el: HTMLElement) {
  const point = noteCentreOnScreen(el);
  pointer("pointerdown", el, point.x, point.y);
  pointer("pointerup", el, point.x, point.y);
}

/**
 * A click on empty board space: the pointer goes down and up on the viewport
 * itself, so the target is neither a note nor a toolbar.
 */
export function clickEmptyBoard(x = 60, y = 60) {
  pointer("pointerdown", viewportEl(), x, y);
  pointer("pointerup", viewportEl(), x, y);
}

export function createNoteAt(screenPoint: { x: number; y: number }) {
  dblclick(viewportEl(), screenPoint.x, screenPoint.y);
}

export function editorEl(): HTMLTextAreaElement {
  return screen.getByTestId("sticky-note-textarea") as HTMLTextAreaElement;
}

export function hasEditor(): boolean {
  return screen.queryByTestId("sticky-note-textarea") !== null;
}

/** Simulates a clipboard paste: one input event with the pasted value already in. */
export async function pasteIntoEditor(value: string) {
  const el = editorEl();
  el.value = value;
  el.setSelectionRange(value.length, value.length);
  await act(async () => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The `background` value the DOM stores for a palette hex (jsdom may normalise it). */
export function expectedBackground(hex: string): string {
  const probe = document.createElement("div");
  probe.style.background = hex;
  return probe.style.background;
}

/** Text of the note that owns a Yjs text object, for model-level assertions. */
export function textOf(doc: Y.Doc, id: string): string {
  return getStickyText(doc, id)?.toString() ?? "";
}

/** Counts `update` events on the document while `fn` runs. */
export async function countUpdates(doc: Y.Doc, fn: () => void | Promise<void>): Promise<number> {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on("update", listener);
  try {
    await fn();
  } finally {
    doc.off("update", listener);
  }
  return updates;
}
