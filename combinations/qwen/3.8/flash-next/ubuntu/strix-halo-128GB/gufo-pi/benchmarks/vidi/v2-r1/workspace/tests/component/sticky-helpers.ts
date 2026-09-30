import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type * as Y from 'yjs';

import { snapshot } from '../../src/shared/board-model';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../../src/client/canvas/camera';
import { initialCamera, readCamera } from './fixture';

/**
 * Shared handles for the story 2 component suites.
 *
 * A note is addressed by its index in paint order, which is the order of the
 * document snapshot (`(z, id)`), so a UI assertion and a model assertion always
 * talk about the same note. Screen positions come from `worldToScreen` for the
 * camera as rendered right now, so nothing here assumes where the board starts.
 */

export const CENTRE: Point = { x: 640, y: 400 };
export const HALF = STICKY_SIZE_WORLD / 2;
export const COLORS = Object.keys(STICKY_COLORS) as (keyof typeof STICKY_COLORS)[];

export function currentCamera(): Camera {
  return window.__vidi6?.getCamera() ?? initialCamera();
}

/**
 * Move the camera and wait until the rendered board agrees with it. The camera
 * is coalesced to one render per animation frame, so a test that jumps the
 * camera has to let that frame happen before it measures anything.
 */
export async function setCamera(camera: Camera): Promise<void> {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('window.__vidi6 is missing; run Vitest with mode "test"');
  hooks.setCamera(camera);
  const viewport = screen.getByTestId('viewport');
  await waitFor(() => {
    const rendered = readCamera(viewport);
    if (
      rendered.x !== camera.x ||
      rendered.y !== camera.y ||
      rendered.zoom !== camera.zoom
    ) {
      throw new Error(`the board still shows ${JSON.stringify(rendered)}`);
    }
  });
}

export function doc(): Y.Doc {
  const value = window.__vidi6?.getDoc?.();
  if (!value) {
    throw new Error('window.__vidi6.getDoc is missing; run Vitest with mode "test"');
  }
  return value;
}

/** The notes as the shared document holds them, back to front. */
export function modelNotes() {
  return snapshot(doc());
}

/**
 * The notes in paint order: `z-index` decides what is on top, and the elements
 * themselves are rendered in a stable order (raising a note must not move its
 * node, or a drag would lose pointer capture).
 */
export function noteElements(): HTMLElement[] {
  const elements = screen.getAllByTestId('sticky-note') as HTMLElement[];
  return elements
    .map((element, position) => ({ element, position }))
    .sort((a, b) => {
      const z = Number(a.element.style.zIndex || 0) - Number(b.element.style.zIndex || 0);
      return z !== 0 ? z : a.position - b.position;
    })
    .map((entry) => entry.element);
}

export function noteCount(): number {
  return screen.queryAllByTestId('sticky-note').length;
}

/** Note `index` in paint order. */
export function note(index = 0): HTMLElement {
  const elements = noteElements();
  const element = elements[index];
  if (!element) throw new Error(`expected a note at index ${index}, found ${elements.length}`);
  return element;
}

export interface NoteView {
  id: string;
  x: number;
  y: number;
  color: string;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
}

export function view(index = 0): NoteView {
  const element = note(index);
  return {
    id: element.dataset.noteId ?? '',
    x: Number(element.dataset.noteX),
    y: Number(element.dataset.noteY),
    color: element.dataset.color ?? '',
    selected: element.dataset.selected === 'true',
    editing: element.dataset.editing === 'true',
    dragging: element.dataset.dragging === 'true',
  };
}

export function textOf(index = 0): string {
  return within(note(index)).getByTestId('sticky-text').textContent ?? '';
}

/** Empty board space, inside the board transform. */
export function surface(): HTMLElement {
  return screen.getByTestId('world-layer') as HTMLElement;
}

/** A point of a note in screen pixels, for the camera as rendered right now. */
export function pointOnNote(index: number, offsetX = HALF, offsetY = HALF): Point {
  const at = view(index);
  return worldToScreen(currentCamera(), { x: at.x + offsetX, y: at.y + offsetY });
}

export function centreOf(index = 0): Point {
  return pointOnNote(index);
}

/** Create a note by double-clicking empty board space; it opens in edit mode. */
export function createNote(at: Point = CENTRE): void {
  fireEvent.doubleClick(surface(), { clientX: at.x, clientY: at.y });
}

/** Press and release on empty board space without travel: the way to deselect. */
export function clickEmptyBoard(at: Point = { x: 900, y: 120 }): void {
  fireEvent.pointerDown(surface(), { clientX: at.x, clientY: at.y, pointerId: 9, button: 0 });
  fireEvent.pointerUp(surface(), { clientX: at.x, clientY: at.y, pointerId: 9, button: 0 });
}

export interface DragOptions {
  /** Moves between press and release. */
  steps?: number;
  /** Release with this event instead of pointerup. */
  release?: 'up' | 'cancel' | 'lost';
  pointerId?: number;
  /** Where on the note to grab it (offsets in world units from its top-left). */
  grab?: { dx: number; dy: number };
}

/**
 * Press a note, move it by a screen delta and release. Positions are screen
 * pixels; the delta is what the user's pointer travels.
 */
export function dragNote(index: number, delta: Point, options: DragOptions = {}): void {
  const { steps = 4, release = 'up', pointerId = 1, grab = { dx: HALF, dy: HALF } } = options;
  const element = note(index);
  const from = pointOnNote(index, grab.dx, grab.dy);
  fireEvent.pointerDown(element, { clientX: from.x, clientY: from.y, pointerId, button: 0 });
  for (let step = 1; step <= steps; step += 1) {
    fireEvent.pointerMove(window, {
      clientX: from.x + (delta.x * step) / steps,
      clientY: from.y + (delta.y * step) / steps,
      pointerId,
      buttons: 1,
    });
  }
  const to = { clientX: from.x + delta.x, clientY: from.y + delta.y };
  if (release === 'cancel') fireEvent.pointerCancel(window, { ...to, pointerId });
  else if (release === 'lost') fireEvent.pointerCancel(window, { ...to, pointerId });
  else fireEvent.pointerUp(window, { ...to, pointerId, button: 0 });
}

/** A press that stops after a given screen travel, without releasing. */
export function pressAndMove(
  index: number,
  delta: Point,
  options: DragOptions = {},
): { release(release?: DragOptions['release']): void } {
  const { steps = 3, pointerId = 1, grab = { dx: HALF, dy: HALF } } = options;
  const element = note(index);
  const from = pointOnNote(index, grab.dx, grab.dy);
  fireEvent.pointerDown(element, { clientX: from.x, clientY: from.y, pointerId, button: 0 });
  for (let step = 1; step <= steps; step += 1) {
    fireEvent.pointerMove(window, {
      clientX: from.x + (delta.x * step) / steps,
      clientY: from.y + (delta.y * step) / steps,
      pointerId,
      buttons: 1,
    });
  }
  return {
    release: (release: DragOptions['release'] = 'up') => {
      const to = { clientX: from.x + delta.x, clientY: from.y + delta.y, pointerId };
      if (release === 'cancel') fireEvent.pointerCancel(window, to);
      else if (release === 'lost') fireEvent.pointerCancel(window, to);
      else fireEvent.pointerUp(window, { ...to, button: 0 });
    },
  };
}

/** Select a note with a short press, after dropping any selection. */
export function selectNote(index = 0): void {
  clickEmptyBoard();
  expectSelected(index, false);
  const at = centreOf(index);
  const element = note(index);
  fireEvent.pointerDown(element, { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });
  fireEvent.pointerUp(element, { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });
}

export function expectSelected(index: number, selected: boolean): void {
  if (view(index).selected !== selected) {
    throw new Error(
      `expected note ${index} selected=${selected}, got ${view(index).selected}`,
    );
  }
}

// ---- text editing ----

export function editor(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
}

/** Change the text of the open editor the way a text field does. */
export function typeText(text: string): void {
  fireEvent.change(editor(), { target: { value: text } });
}

/** Append to the open editor, keeping what is already there. */
export function appendText(text: string): void {
  typeText(editor().value + text);
}

export function pressEscape(): void {
  fireEvent.keyDown(editor(), { key: 'Escape' });
}

/** A note created, typed into and left selected but not editing. */
export function createNoteWithText(text: string, at: Point = CENTRE): void {
  createNote(at);
  typeText(text);
  pressEscape();
}

// ---- document observation ----

/** Counts the local changes a component writes to the shared document. */
export function watchLocalUpdates(): { readonly count: () => number; stop: () => void } {
  let updates = 0;
  const listener = (_update: unknown, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) updates += 1;
  };
  doc().on('update', listener);
  return {
    count: () => updates,
    stop: () => doc().off('update', listener),
  };
}

/** The rendered colour of a note, as jsdom serialises a hex colour. */
export function cssColor(hex: string): string {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

export { screenToWorld };
