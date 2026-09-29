// Shared helpers for the story 7 component tests (selection, marquee,
// transform). The board is the full app at the 1280x800 fixture with the
// HOME camera, so world (0,0) is screen (640, 400).

import { act } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, initDoc, snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import { renderApp } from './helpers';

/** HOME camera: world (0,0) renders at screen (640, 400). */
export const HOME = { x: -640, y: -400, zoom: 1 };

/** World (board units) → screen px under the HOME camera (zoom 1). */
export function screenX(wx: number): number {
  return wx - HOME.x;
}
export function screenY(wy: number): number {
  return wy - HOME.y;
}

/** The app's Y.Doc via the test hook. */
export function boardDoc(): Y.Doc {
  const hook = window.__vidi6;
  if (hook === undefined) throw new Error('test hook not installed');
  return hook.getDoc();
}

/** Create a sticky note with its top-left corner at world (x, y). */
export function noteAt(x: number, y: number): string {
  const doc = boardDoc();
  initDoc(doc);
  return createSticky(doc, { x: x + 100, y: y + 100 }); // centre → top-left
}

/** All rendered sticky notes. */
export function noteEls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]'));
}

/** The live board content (from the app's doc). */
export function liveNotes(): readonly ObjectSnapshot[] {
  return snapshot(boardDoc());
}

/** A pointer event with the given keys (jsdom has no PointerEvent). */
export function keyedPointerEvent(type: string, x: number, y: number, shiftKey = false): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    shiftKey,
  });
}

export function dispatchOn(el: Element, event: Event): void {
  act(() => {
    el.dispatchEvent(event);
  });
}

/** The resize handle of the selection overlay (screen space). */
export function handleEl(container: HTMLElement, handle: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-handle="${handle}"]`);
  if (el === null) throw new Error(`no ${handle} handle rendered`);
  return el;
}

/** The selection bar ("N selected" + Delete), if any. */
export function selectionBar(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="selection-bar"]');
}

/** The "N selected" count text, if any. */
export function selectionCount(container: HTMLElement): string | null {
  return container.querySelector<HTMLElement>('[data-testid="selection-count"]')?.textContent ?? null;
}

export type Board = RenderResult & { doc: Y.Doc };

/** renderApp + a handle to the live doc. */
export async function board(): Promise<Board> {
  const result = await renderApp();
  return { ...result, doc: boardDoc() };
}

export function gestureLog(): { starts: number; ends: number } {
  const hook = window.__vidi6;
  if (hook === undefined) throw new Error('test hook not installed');
  return hook.getGestureLog();
}

export function setConnection(state: string): void {
  const hook = window.__vidi6;
  if (hook === undefined) throw new Error('test hook not installed');
  act(() => {
    hook.setConnectionState(state as never);
  });
}
