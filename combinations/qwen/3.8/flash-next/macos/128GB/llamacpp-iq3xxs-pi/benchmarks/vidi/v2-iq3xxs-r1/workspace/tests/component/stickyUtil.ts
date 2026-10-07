import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../../src/shared/board-model';
import { deleteObject } from '../../src/shared/board-model';
import type { BoardTestApi } from '../../src/client/canvas/testHooks';
import { dispatchPointer } from './util';

/** The test-only API App/useCamera install in MODE === 'test'. */
export function hook(): BoardTestApi {
  const api = (window as Window & { __vidi6?: BoardTestApi }).__vidi6;
  if (!api) throw new Error('test hook (window.__vidi6) not installed');
  return api;
}

export function getSnapshot(): readonly StickySnapshot[] {
  return hook().getSnapshot();
}

export function getSelection(): { selectedId: string | null; editingId: string | null } {
  return hook().getSelection();
}

export function getDoc(): Y.Doc {
  return hook().getDoc();
}

export function notes(): readonly StickySnapshot[] {
  return getSnapshot();
}

export function noteEls(): HTMLElement[] {
  return screen.getAllByTestId('sticky-note');
}

export function noteEl(index = 0): HTMLElement {
  return noteEls()[index]!;
}

export function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

// One user-event instance per module: setup() attaches document listeners, so
// it is created once and reused by every helper.
type User = ReturnType<typeof userEvent.setup>;
let instance: User | undefined;
function user(): User {
  if (!instance) instance = userEvent.setup();
  return instance;
}

/** Click the toolbar's Sticky note button (creates and starts editing). */
export async function clickCreateSticky(): Promise<void> {
  await user().click(screen.getByTestId('create-sticky'));
}

/** Type into whatever has focus (the note editor right after creation). */
export async function typeText(text: string): Promise<void> {
  await user().keyboard(text);
}

/** Keyboard on the focused element, e.g. '{Escape}'. */
export async function press(keys: string): Promise<void> {
  await user().keyboard(keys);
}

/** A single click on an element by accessible query (e.g. a colour swatch). */
export async function clickElement(el: Element): Promise<void> {
  await user().click(el);
}

/** A point in client (viewport) coordinates. */
export interface At {
  x: number;
  y: number;
}

/** A real (jsdom) double-click with client coordinates. */
export function dispatchDblClick(el: Element, at: At = { x: 0, y: 0 }): void {
  const event = new MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
  });
  act(() => {
    el.dispatchEvent(event);
  });
}

/** Press and release on an element without moving (a "click"). */
export function clickWithPointer(el: Element, at: At = { x: 0, y: 0 }): void {
  dispatchPointer(el, 'pointerdown', { pointerId: 1, clientX: at.x, clientY: at.y });
  dispatchPointer(el, 'pointerup', { pointerId: 1, clientX: at.x, clientY: at.y });
}

/** Press, drag through `path` and release (threshold handling is the caller's). */
export function dragWithPointer(
  el: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 4,
): void {
  dispatchPointer(el, 'pointerdown', { pointerId: 1, clientX: from.x, clientY: from.y });
  for (let i = 1; i <= steps; i++) {
    dispatchPointer(el, 'pointermove', {
      pointerId: 1,
      clientX: from.x + ((to.x - from.x) * i) / steps,
      clientY: from.y + ((to.y - from.y) * i) / steps,
    });
  }
  dispatchPointer(el, 'pointerup', { pointerId: 1, clientX: to.x, clientY: to.y });
}

/** Click empty board space (clears the selection). */
export function clickEmptyBoard(point: At = { x: 5, y: 5 }): void {
  clickWithPointer(viewportEl(), point);
}

/** Delete through the model, as another client (or story 3) would. */
export function modelDelete(id: string): void {
  act(() => {
    deleteObject(getDoc(), id);
  });
}

/**
 * Create a note with the toolbar button, leave editing and drop the selection,
 * so a test can start from a plain unselected note.
 */
export async function createUnselectedNote(text = 'Faster onboarding'): Promise<StickySnapshot> {
  await clickCreateSticky();
  await typeText(text);
  await press('{Escape}');
  clickEmptyBoard();
  const all = notes();
  return all[all.length - 1]!;
}
