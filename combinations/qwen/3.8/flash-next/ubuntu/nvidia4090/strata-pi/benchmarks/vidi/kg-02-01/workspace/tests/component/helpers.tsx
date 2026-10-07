import { act } from "react";
import * as Y from "yjs";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "../../src/client/App";
import {
  createSticky,
  snapshot,
  type StickySnapshot,
} from "../../src/shared/board-model";
import type { Camera } from "../../src/client/canvas/camera";
import { STICKY_SIZE_WORLD, type StickyColor } from "../../src/shared/config";

/** jsdom gives every window the same default size; tests override it. */
export function setWindowSize(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
  window.dispatchEvent(new Event("resize"));
}

export function mountBoard(doc: Y.Doc): void {
  render(<App doc={doc} />);
}

/** Every note the app currently renders, in model order. */
export function notesOf(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc);
}

export function firstNote(doc: Y.Doc): StickySnapshot {
  const notes = notesOf(doc);
  if (notes.length === 0) throw new Error("expected at least one sticky note");
  return notes[0]!;
}

export function noteElements(): HTMLElement[] {
  return screen.queryAllByTestId("sticky-note");
}

export function noteElement(id: string): HTMLElement {
  const found = noteElements().find((candidate) => candidate.dataset.noteId === id);
  if (!found) throw new Error(`no rendered note with id ${id}`);
  return found;
}

export function viewportElement(): HTMLElement {
  return screen.getByTestId("board-viewport");
}

export function cameraNow(): Camera {
  const api = window.__vidi6;
  if (!api) throw new Error("window.__vidi6 is not available");
  return api.getCamera();
}

/** Model mutation from the test side, so React sees it inside act(). */
export function modelChange(change: () => void): void {
  act(() => {
    change();
  });
}

/** Let scheduled React work and animation-frame writes finish. */
export async function settle(times = 2): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });
  }
}

interface PointerOptions {
  x?: number;
  y?: number;
  button?: number;
  shift?: boolean;
  pointerId?: number;
}

function fireEventOn(el: Element, type: string, options: PointerOptions = {}): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: options.pointerId ?? 1,
    pointerType: "mouse",
    isPrimary: true,
    button: options.button ?? 0,
    buttons: type === "pointerup" ? 0 : 1,
    shiftKey: options.shift ?? false,
    clientX: options.x ?? 0,
    clientY: options.y ?? 0,
  });
  // fireEvent (not a raw dispatch) so React's act() wrapping applies.
  fireEvent(el, event);
}

export const pointerDown = (el: Element, x: number, y: number, options: PointerOptions = {}) =>
  fireEventOn(el, "pointerdown", { x, y, ...options });

export const pointerMove = (el: Element, x: number, y: number, options: PointerOptions = {}) =>
  fireEventOn(el, "pointermove", { x, y, ...options });

export const pointerUp = (el: Element, x: number, y: number, options: PointerOptions = {}) =>
  fireEventOn(el, "pointerup", { x, y, ...options });

export const pointerCancel = (el: Element, x: number, y: number, options: PointerOptions = {}) =>
  fireEventOn(el, "pointercancel", { x, y, ...options });

export function clickNote(id: string, at?: { x: number; y: number }): void {
  const el = noteElement(id);
  const x = at?.x ?? 0;
  const y = at?.y ?? 0;
  pointerDown(el, x, y);
  pointerUp(el, x, y);
}

/** The gesture that creates a note in the app: double-click empty board space. */
export function doubleClickBoard(x: number, y: number): void {
  const el = viewportElement();
  pointerDown(el, x, y);
  pointerUp(el, x, y);
  fireEvent(el, new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}

export function doubleClickNote(id: string): void {
  fireEvent(noteElement(id), new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
}

export function pressKey(key: string, target: Element | Window = window): void {
  fireEvent(target, new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

/** Screen point at the centre of a note, using the current camera. */
export function noteScreenPoint(note: StickySnapshot, zoom = cameraNow().zoom): { x: number; y: number } {
  const camera = cameraNow();
  return {
    x: (note.x + STICKY_SIZE_WORLD / 2 - camera.x) * zoom,
    y: (note.y + STICKY_SIZE_WORLD / 2 - camera.y) * zoom,
  };
}

export function createNoteAt(doc: Y.Doc, x: number, y: number, color: StickyColor = "yellow"): string {
  const id = createSticky(doc, { x, y }, color);
  if (!id) throw new Error("createSticky returned no id");
  return id;
}
