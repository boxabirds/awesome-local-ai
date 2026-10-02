import { act, screen } from '@testing-library/react';
import type * as Y from 'yjs';
import type { HarnessHandle } from '../harness/BoardHarness';
import type { Camera } from '../../../src/client/canvas/camera';
import { worldToScreen } from '../../../src/client/canvas/camera';
import type { StickyColor } from '../../../src/shared/config';
import type { Rect } from '../../../src/shared/geometry';
import { pointer, frames } from '../pointerUtils';
import { createTestbox } from '../../fixtures/testbox';
import { snapshot } from '../../../src/shared/board-model';

/** The document as a string, to prove that an action writes nothing. */
export const stateOf = (doc: Y.Doc): string => JSON.stringify(snapshot(doc));

export type P = { x: number; y: number };

/** World point -> viewport screen point for the given camera. */
export function sp(cam: Camera, p: P): P {
  return worldToScreen(cam, p);
}

export const IDENTITY: Camera = { x: 0, y: 0, zoom: 1 };

/** Change the camera, wrapped in `act` so the board re-renders first. */
export function setCamera(handle: HarnessHandle, cam: Camera): void {
  act(() => {
    handle.setCamera(cam);
  });
}

/** Create a sticky note. `at` is its centre, as everywhere in the app. */
export function addNote(handle: HarnessHandle, at: P, text?: string, color?: StickyColor): string {
  let id = '';
  act(() => {
    id = handle.addSticky(at, text, color);
  });
  return id;
}

/** Create a testbox. `at` is its top-left, the coordinate the document stores. */
export function addBox(doc: Y.Doc, at: P, size?: { width: number; height: number }): string {
  let id = '';
  act(() => {
    id = createTestbox(doc, at, size);
  });
  return id;
}

const byObject = (testid: string, id: string): HTMLElement => {
  const el = document.querySelector(`[data-testid="${testid}"][data-note-id="${id}"]`);
  if (!el) throw new Error(`no ${testid} for object ${id}`);
  return el as HTMLElement;
};

export const noteEl = (id: string): HTMLElement => byObject('sticky-note', id);
export const boxEl = (id: string): HTMLElement => byObject('testbox', id);
export const viewport = (): HTMLElement => screen.getByTestId('board-viewport');
export const outlineOf = (id: string): HTMLElement =>
  screen.getByTestId('selection-outline').parentElement!
    .querySelector(`[data-testid="selection-outline"][data-object-id="${id}"]`) as HTMLElement;

/** Press and release: a click that selects. */
export function click(el: Element | Window, at: P, init: PointerEventInit = {}): void {
  pointer(el, 'pointerdown', at.x, at.y, init);
  pointer(el, 'pointerup', at.x, at.y, init);
}

export function shiftClick(el: Element | Window, at: P): void {
  click(el, at, { shiftKey: true });
}

/**
 * Press on `target`, move in a few steps applying each animation frame, then
 * release. Coordinates are screen pixels.
 */
export function drag(target: Element | Window, from: P, to: P, init: PointerEventInit = {}): void {
  pointer(target, 'pointerdown', from.x, from.y, init);
  const steps = 4;
  for (let i = 1; i <= steps; i += 1) {
    moveTo(
      target,
      { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps },
      init,
    );
  }
  pointer(target, 'pointerup', to.x, to.y, init);
}

/**
 * Move an already-pressed pointer and let the throttled frame run. The events go
 * out on the element the gesture started on: React handlers of that element see
 * them, and they still bubble to the window listeners of the gesture.
 */
export function moveTo(target: Element | Window, p: P, init: PointerEventInit = {}): void {
  pointer(target, 'pointermove', p.x, p.y, init);
  frames(1);
}

/** The live rect of one object in the document (top-left and size). */
export function rectOf(snapshot: readonly RectLike[], id: string): Rect & { id: string } {
  const o = snapshot.find((s) => s.id === id);
  if (!o) throw new Error(`object ${id} is not on the board`);
  return { id, x: o.x, y: o.y, width: o.width ?? 0, height: o.height ?? 0 };
}

interface RectLike {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}
