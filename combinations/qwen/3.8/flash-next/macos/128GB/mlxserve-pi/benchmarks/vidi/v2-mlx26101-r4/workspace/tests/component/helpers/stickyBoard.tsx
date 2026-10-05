/**
 * Shared helpers for the story 2 component tests.
 *
 * Tests drive the real `App` with a real `Y.Doc`: the board document is read
 * through the test hook the app registers in test mode (so assertions are about
 * what the model holds, not about what a component happens to render), and the
 * notes are found in the DOM by the attributes the note itself publishes.
 */
import { expect } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { App } from '../../../src/client/App';
import type { BoardConnector } from '../../../src/client/board/useBoardDoc';
import type { Camera } from '../../../src/client/canvas/camera';
import { cameraStore } from '../../../src/client/canvas/cameraStore';
import { initDoc } from '../../../src/shared/board-model';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../../src/shared/config';

/** jsdom's window is the board area; the board opens framed on it. */
export const AREA = { width: window.innerWidth, height: window.innerHeight };
/** The centre of the board area, where a toolbar-created note is centred. */
export const CENTRE = { x: AREA.width / 2, y: AREA.height / 2 };

const POINTER_ID = 1;

/**
 * A connection that connects to nothing. Component tests are about components: a
 * socket opened from jsdom would put a second source of change into a test that is
 * trying to make one, and would leave a test failing because a port was busy.
 * The badge tests hand `App` a connector of their own, which is the same seam.
 */
export const noConnection: BoardConnector = () => ({ destroy(): void {} });

export function renderBoard(connect: BoardConnector = noConnection): void {
  render(<App connect={connect} />);
}

export function surface(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

export function camera(): Camera {
  return cameraStore.getState().camera;
}

/** The document the mounted app owns; the tests' view of the truth. */
export function doc(): Y.Doc {
  const board = window.__vidi6?.getBoardDoc();
  if (!board) throw new Error('the board did not register its document');
  return board;
}

/** The notes as the model reports them, in stacking order. */
export function stickies(): readonly StickySnapshot[] {
  return window.__vidi6?.getStickies() ?? [];
}

/** Note elements in the order they were made; the stacking is in their `zIndex`. */
export function noteElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]'));
}

/** The stacking number an element is drawn with, 0 when it says nothing. */
export function zIndex(id: string): number {
  return Number.parseFloat(noteElementById(id).style.zIndex || '0');
}

export function noteElement(index = 0): HTMLElement {
  const elements = noteElements();
  const element = elements[index];
  if (!element) throw new Error(`no note at index ${index} of ${elements.length}`);
  return element;
}

export function noteId(index = 0): string {
  const id = noteElement(index).dataset.noteId;
  if (!id) throw new Error('a rendered note has no id');
  return id;
}

export function sticky(index = 0): StickySnapshot {
  const note = stickies()[index];
  if (!note) throw new Error(`no note at index ${index} in ${JSON.stringify(stickies())}`);
  return note;
}

export function textarea(): HTMLTextAreaElement {
  const element = screen.getByTestId('sticky-textarea');
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('the editor is not a textarea');
  return element;
}

export function hasTextarea(): boolean {
  return screen.queryByTestId('sticky-textarea') !== null;
}

export function toolbarPresent(): boolean {
  return screen.queryByTestId('note-toolbar') !== null;
}

function pointerInit(x: number, y: number, init: PointerEventInit = {}): PointerEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
    ...init,
  };
}

/** A raw pointer event, as the browser would deliver it. */
export function pointerEvent(type: string, x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, pointerInit(x, y, init));
}

export function pointerDown(target: Element, x: number, y: number, init: PointerEventInit = {}): boolean {
  return fireEvent(target, pointerEvent('pointerdown', x, y, init));
}

export function pointerMove(target: Element, x: number, y: number, init: PointerEventInit = {}): boolean {
  return fireEvent(target, pointerEvent('pointermove', x, y, init));
}

export function pointerUp(target: Element, x: number, y: number, init: PointerEventInit = {}): boolean {
  return fireEvent(
    target,
    pointerEvent('pointerup', x, y, { buttons: 0, ...init }),
  );
}

export function pointerCancel(target: Element, x: number, y: number): boolean {
  return fireEvent(target, pointerEvent('pointercancel', x, y, { buttons: 0 }));
}

/**
 * Double-click the board at a screen point: the way a note is really made.
 * Returns after the note exists and is being edited.
 */
export async function doubleClickBoard(x: number, y: number): Promise<void> {
  fireEvent.doubleClick(surface(), { clientX: x, clientY: y });
  await waitFor(() => expect(hasTextarea()).toBe(true));
}

/** Click the "Sticky note" button; returns after the note exists. */
export async function clickStickyButton(): Promise<void> {
  fireEvent.click(screen.getByTestId('create-sticky'));
  await waitFor(() => expect(hasTextarea()).toBe(true));
}

/** The centre of a rendered note, in world units, from the model. */
export function centreOf(note: StickySnapshot): { x: number; y: number } {
  return { x: note.x + STICKY_SIZE_WORLD / 2, y: note.y + STICKY_SIZE_WORLD / 2 };
}

/**
 * Put text in the editor the way a browser does when there is no input method in
 * the way: the value changes, then an `input` event reports it.
 */
export function typeText(text: string): void {
  const element = textarea();
  element.value = element.value + text;
  fireEvent.input(element);
}

/** Replace the editor's whole value (stands in for a paste). */
export function pasteText(text: string): void {
  const element = textarea();
  element.value = text;
  fireEvent.input(element);
}

/** Select a note without editing it: create it, then leave with Escape. */
export async function createSelectedNote(x = 300, y = 200, text = ''): Promise<string> {
  await doubleClickBoard(x, y);
  if (text) typeText(text);
  fireEvent.keyDown(textarea(), { key: 'Escape' });
  await waitFor(() => expect(hasTextarea()).toBe(false));
  return noteId();
}

/** Wait until the note's interaction attribute reads as expected. */
export async function expectInteraction(index: number, state: string): Promise<void> {
  await waitFor(() => expect(noteElement(index).dataset.interaction).toBe(state));
}

/**
 * A note by the id it carries in the DOM. The place a note holds in the document is
 * the order it was made in, so it does not depend on which note is on top; ids are
 * still the honest way to name a note in a test, because their order says nothing
 * about how they are stacked.
 */
export function noteElementById(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`no rendered note with id ${id}`);
  return element;
}

/** The model entry for a note id; throws when the note is gone. */
export function stickyById(id: string): StickySnapshot {
  const note = stickies().find((entry) => entry.id === id);
  if (!note) throw new Error(`no note with id ${id} in the document`);
  return note;
}

/**
 * What the board receives when somebody else edits the same notes: the edit is made to
 * a copy of the document — which is what the room holds — and only the difference comes
 * back, arriving with no local mark on it. That is the same shape of change a socket
 * delivers, so a component cannot tell the difference, and the two documents are left
 * holding the same words, which is what convergence means.
 */
export function somebodyElse(edit: (doc: Y.Doc) => void): void {
  const here = doc();
  const there = new Y.Doc();
  initDoc(there);
  Y.applyUpdate(there, Y.encodeStateAsUpdate(here));
  edit(there);
  const update = Y.encodeStateAsUpdate(there, Y.encodeStateVector(here));
  there.destroy();

  act(() => {
    Y.applyUpdate(here, update);
  });
}
