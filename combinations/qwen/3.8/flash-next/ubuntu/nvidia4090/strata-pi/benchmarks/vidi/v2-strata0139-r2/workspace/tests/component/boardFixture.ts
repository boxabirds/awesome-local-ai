import { act, fireEvent, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import * as Y from "yjs";
import {
  createSticky,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from "../../src/shared/board-model";
import { type StickyColor } from "../../src/shared/config";

/**
 * Shared helpers for the story 2 component tests. Note state is asserted on
 * the Y.Doc (jsdom has no layout engine), and interaction state on the data
 * attributes the components expose.
 */

export const NOTE_SELECTOR = '[data-testid="sticky-note"]';

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

export function selectedIds(screen: RenderResult): string[] {
  return noteElements(screen)
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
): void {
  fireEvent[name](target, { pointerId: 1, pointerType: "mouse", button: 0, clientX: x, clientY: y });
}

/** Press, move, release. Positions are absolute screen pixels. */
export function dragNote(
  screen: RenderResult,
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const el = noteById(screen, id);
  pointer("pointerDown", el, from.x, from.y);
  pointer("pointerMove", el, from.x, from.y);
  pointer("pointerMove", el, to.x, to.y);
  pointer("pointerUp", el, to.x, to.y);
}

export function selectNote(screen: RenderResult, id: string): void {
  dragNote(screen, id, { x: 100, y: 100 }, { x: 100, y: 100 });
}

export function pressKey(key: string, target: Element = document.body): void {
  fireEvent.keyDown(target, { key, code: key });
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
