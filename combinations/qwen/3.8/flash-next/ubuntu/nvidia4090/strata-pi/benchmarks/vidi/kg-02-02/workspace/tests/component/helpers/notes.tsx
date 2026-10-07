import { act, fireEvent, render } from "@testing-library/react";
import * as Y from "yjs";
import { createSticky, deleteObject, snapshot, type StickySnapshot } from "../../../src/shared/board-model";
import { App } from "../../../src/client/App";
import { STICKY_SIZE_WORLD } from "../../../src/shared/config";
import type { Camera } from "../../../src/client/canvas/camera";

export const VIEWPORT_SIZE = { width: 1200, height: 800 };

export function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

/** Renders the whole board (viewport, toolbar, notes) over a given document. */
export function renderBoard(doc: Y.Doc) {
  setWindowSize(VIEWPORT_SIZE.width, VIEWPORT_SIZE.height);
  return render(<App doc={doc} />);
}

/** Let rAF-coalesced work (drag moves, camera updates) and React renders land. */
export async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

export function pointer(type: string, el: Element, x: number, y: number, pointerId = 1) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId,
    pointerType: "mouse",
    button: 0,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    clientX: x,
    clientY: y,
  });
  el.dispatchEvent(event);
}

export function viewportEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-testid='board-viewport']");
  if (!el) throw new Error("board viewport is not rendered");
  return el;
}

export function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id='${id}']`);
  if (!el) throw new Error(`note ${id} is not rendered`);
  return el;
}

export function noteElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-note-id]")];
}

export function camera(): Camera {
  const hook = window.__vidi6;
  if (!hook) throw new Error("window.__vidi6 test hook is not installed");
  return hook.getCamera();
}

/** The camera at the moment the board painted, from the world layer transform. */
export function renderedZoom(): number {
  const world = document.querySelector<HTMLElement>("[data-testid='board-world']");
  if (!world) throw new Error("board world layer is missing");
  const match = /scale\(([^)]*)\)/.exec(world.style.transform);
  return match ? Number(match[1]) : 1;
}

export function onlyNote(doc: Y.Doc): StickySnapshot {
  const notes = snapshot(doc);
  if (notes.length !== 1) throw new Error(`expected one note, found ${notes.length}`);
  return notes[0]!;
}

/** A note created centred on the world point (0,0), i.e. top-left -100,-100. */
export function addNoteAtOrigin(doc: Y.Doc): string {
  const id = createSticky(doc, { x: 0, y: 0 });
  if (id === false) throw new Error("createSticky was rejected");
  return id;
}

export const NOTE_HALF = STICKY_SIZE_WORLD / 2;

/** Press and release a note without moving the pointer. */
export function clickNote(id: string, x = 300, y = 300) {
  const el = noteEl(id);
  pointer("pointerdown", el, x, y);
  pointer("pointerup", el, x, y);
}

export function pressKey(key: string, target: Element = document.body) {
  fireEvent.keyDown(target, { key, code: key });
}

export function removeNote(doc: Y.Doc, id: string) {
  deleteObject(doc, id);
}
