import { act, render } from '@testing-library/react';
import { expect, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../../src/client/App';
import {
  screenToWorld,
  worldToScreen,
  type Camera,
  type Point,
} from '../../../src/client/canvas/camera';
import {
  createSticky,
  deleteObject,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../../src/shared/config';
import { setWindowSize, VIEWPORT_FIXTURE } from '../setup';

export { setWindowSize };

export { VIEWPORT_FIXTURE };

export const ORIGIN_MARKER_SIZE_PX = 16;

/**
 * Render the real app so input handlers, camera state and controls are all wired,
 * then wait for the board to centre itself on its starting point (the first camera
 * change, which happens one animation frame after mount).
 */
export async function renderBoard(): Promise<void> {
  render(<App />);
  await vi.waitFor(() => {
    const cam = readCamera();
    if (cam.x !== -VIEWPORT_FIXTURE.width / 2 || cam.y !== -VIEWPORT_FIXTURE.height / 2) {
      throw new Error(`board has not centred itself yet: ${JSON.stringify(cam)}`);
    }
  });
  await flushFrames();
}

export function viewportElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="viewport"]');
  if (!element) throw new Error('viewport is not mounted');
  return element;
}

export function worldLayerElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="world-layer"]');
  if (!element) throw new Error('world layer is not mounted');
  return element;
}

export function zoomLabel(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="zoom-label"]');
  if (!element) throw new Error('zoom label is not mounted');
  return element;
}

export function buttonByLabel(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!element) throw new Error(`no button with aria-label "${label}"`);
  return element;
}

export function resetButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(
    'button[data-testid="reset-view"]',
  );
  if (!element) throw new Error('no Reset view button');
  return element;
}

/** The camera as rendered in the DOM. */
export function readCamera(): Camera {
  const element = viewportElement();
  const x = Number(element.dataset.cameraX);
  const y = Number(element.dataset.cameraY);
  const zoom = Number(element.dataset.cameraZoom);
  if (![x, y, zoom].every(Number.isFinite)) {
    throw new Error(`camera attributes are not numbers: ${element.outerHTML.slice(0, 200)}`);
  }
  return { x, y, zoom };
}

export function boardState(): string {
  return viewportElement().dataset.state ?? '';
}

export function worldTransform(): string {
  return worldLayerElement().style.transform;
}

/**
 * Camera updates are coalesced to one per animation frame; flush it and let React
 * re-render before asserting.
 */
export async function flushFrames(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

export async function waitForCamera(expected: (cam: Camera) => boolean): Promise<Camera> {
  let cam: Camera = readCamera();
  await vi.waitFor(() => {
    cam = readCamera();
    if (!expected(cam)) throw new Error(`camera still ${JSON.stringify(cam)}`);
  });
  return cam;
}

export function expectCameraCloseTo(actual: Camera, expected: Camera, digits = 6): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.zoom).toBeCloseTo(expected.zoom, digits);
}

/** Where the origin marker (and therefore the board's starting point) appears on screen. */
export function markerScreenPosition(cam: Camera): { x: number; y: number } {
  return worldToScreen(cam, { x: 0, y: 0 });
}

interface PointerOptions {
  pointerId?: number;
  pointerType?: 'mouse' | 'pen' | 'touch';
}

function dispatchPointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  options: PointerOptions = {},
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: options.pointerId ?? 1,
    pointerType: options.pointerType ?? 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
  });
  viewportElement().dispatchEvent(event);
  return event;
}

export function pointerDown(x: number, y: number, options?: PointerOptions): void {
  dispatchPointer('pointerdown', x, y, options);
}

export function pointerMove(x: number, y: number, options?: PointerOptions): void {
  dispatchPointer('pointermove', x, y, options);
}

export function pointerUp(x: number, y: number, options?: PointerOptions): void {
  dispatchPointer('pointerup', x, y, options);
}

export function pointerCancel(x: number, y: number, options?: PointerOptions): void {
  dispatchPointer('pointercancel', x, y, options);
}

/** Drag the board by (dx, dy) screen pixels, in steps, the way a mouse does. */
export async function dragBoard(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 4,
): Promise<void> {
  pointerDown(from.x, from.y);
  for (let i = 1; i <= steps; i += 1) {
    pointerMove(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await flushFrames();
  }
  pointerUp(to.x, to.y);
  await flushFrames();
}

export interface WheelResult {
  defaultPrevented: boolean;
}

export function wheel(
  options: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
  },
  at: { x: number; y: number } = { x: VIEWPORT_FIXTURE.width / 2, y: VIEWPORT_FIXTURE.height / 2 },
  target: EventTarget = viewportElement(),
): WheelResult {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    deltaMode: options.deltaMode ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
  });
  target.dispatchEvent(event);
  return { defaultPrevented: event.defaultPrevented };
}

/** Safari's pinch gesture events, which jsdom does not implement. */
export function safariGesture(
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  at: { x: number; y: number },
): { defaultPrevented: boolean } {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: at.x, clientY: at.y });
  viewportElement().dispatchEvent(event);
  return { defaultPrevented: event.defaultPrevented };
}

/**
 * The world point currently under a screen point, and where that same world point
 * lands after a camera change. Used to assert zoom keeps the pointer's spot fixed.
 */
/** The world point that a screen point currently points at. */
export function worldPointAt(cam: Camera, at: { x: number; y: number }): { x: number; y: number } {
  return screenToWorld(cam, at);
}

/** Where that world point is drawn after the camera changed. */
export function screenPointOf(cam: Camera, world: { x: number; y: number }): { x: number; y: number } {
  return worldToScreen(cam, world);
}

/* ---------------------------------------------------------------------------
 * Story 2: sticky notes.
 *
 * Notes are asserted in two places: the DOM (what the user sees) and the document
 * behind it (what other people would see), read back through `snapshot()`.
 * ------------------------------------------------------------------------ */

/** The live document the board is editing. */
export function boardDoc(): Y.Doc {
  const hooks = (window as unknown as { __vidi6?: { boardDoc?: () => Y.Doc } }).__vidi6;
  if (!hooks?.boardDoc) {
    throw new Error('window.__vidi6.boardDoc() is not available outside test mode');
  }
  return hooks.boardDoc();
}

/** The model as the board renders it. */
export function boardNotes(doc: Y.Doc = boardDoc()): readonly StickySnapshot[] {
  return snapshot(doc);
}

export function noteElements(container: ParentNode = document.body): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-note-id]'));
}

export function noteElement(id: string, container: ParentNode = document.body): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`no note element for id ${id}`);
  return element;
}

export function selectedNoteIds(container: ParentNode = document.body): string[] {
  return noteElements(container)
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.noteId ?? '');
}

export function editorElement(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"]');
}

export function counterElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="sticky-counter"]');
}

export function noteToolbarElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="note-toolbar"]');
}

export function stickyToolbarButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('[data-testid="create-sticky"]');
  if (!element) throw new Error('no Sticky note button');
  return element;
}

/** Where a note's centre sits on screen right now. */
export function noteCentreOnScreen(id: string, doc: Y.Doc = boardDoc()): Point {
  const note = boardNotes(doc).find((entry) => entry.id === id);
  if (!note) throw new Error(`no note with id ${id} in the document`);
  return worldToScreen(readCamera(), {
    x: note.x + STICKY_SIZE_WORLD / 2,
    y: note.y + STICKY_SIZE_WORLD / 2,
  });
}

function pointerOn(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  at: Point,
): void {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
    }),
  );
}

export function pointerDownOn(element: Element, at: Point): void {
  pointerOn(element, 'pointerdown', at);
}

export function pointerMoveOn(element: Element, at: Point): void {
  pointerOn(element, 'pointermove', at);
}

export function pointerUpOn(element: Element, at: Point): void {
  pointerOn(element, 'pointerup', at);
}

export function pointerCancelOn(element: Element, at: Point): void {
  pointerOn(element, 'pointercancel', at);
}

/** Press and release without moving: a click. */
export async function click(at: Point, element: Element = viewportElement()): Promise<void> {
  pointerOn(element, 'pointerdown', at);
  await flushFrames();
  pointerOn(element, 'pointerup', at);
  await flushFrames();
}

export function doubleClick(at: Point, element: Element = viewportElement()): void {
  element.dispatchEvent(
    new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
    }),
  );
}

/** Drag an element in a straight line, in screen pixels, one flush per step. */
export async function drag(
  element: Element,
  from: Point,
  to: Point,
  steps = 3,
): Promise<void> {
  pointerDownOn(element, from);
  for (let step = 1; step <= steps; step += 1) {
    pointerMoveOn(element, {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
    await flushFrames();
  }
  pointerUpOn(element, to);
  await flushFrames();
}

export function pressKey(key: string, target: EventTarget = window): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

/** Type into the open editor the way a keyboard does. */
export function typeText(text: string): void {
  const editor = editorElement();
  if (!editor) throw new Error('no note is being edited');
  act(() => {
    editor.value += text;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Paste: one `input` event carrying the whole string. */
export function pasteText(text: string): void {
  typeText(text);
}

/** Create a note through the toolbar button; it lands in the middle of the screen. */
export async function createNoteViaButton(): Promise<string> {
  const before = new Set(boardNotes().map((note) => note.id));
  act(() => {
    stickyToolbarButton().click();
  });
  await flushFrames();
  const created = boardNotes().find((note) => !before.has(note.id));
  if (!created) throw new Error('the Sticky note button created no note');
  return created.id;
}

/** Create a note straight in the document, as another client (or story 3) would. */
export function createNote(at: Point, doc: Y.Doc = boardDoc()): string {
  let created: string | false = false;
  act(() => {
    created = createSticky(doc, at);
  });
  if (created === false) throw new Error(`no note created at ${JSON.stringify(at)}`);
  return created;
}

/** Notes as plain positions, for asserting drags. */
export function notePositions(doc: Y.Doc = boardDoc()): Array<{ id: string; x: number; y: number; z: number }> {
  return boardNotes(doc).map((note) => ({ id: note.id, x: note.x, y: note.y, z: note.z }));
}

export function notePosition(id: string, doc: Y.Doc = boardDoc()): { x: number; y: number; z: number; color: string } {
  const note = boardNotes(doc).find((entry) => entry.id === id);
  if (!note) throw new Error(`no note with id ${id} in the document`);
  return { x: note.x, y: note.y, z: note.z, color: note.color };
}

export function swatchButton(colour: string): HTMLButtonElement {
  const label = `${colour.slice(0, 1).toUpperCase()}${colour.slice(1)} colour`;
  const element = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!element) throw new Error(`no swatch with aria-label "${label}"`);
  return element;
}

export function deleteNoteButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('button[aria-label="Delete note"]');
  if (!element) throw new Error('no button with aria-label "Delete note"');
  return element;
}

export function deleteNote(id: string, doc: Y.Doc = boardDoc()): void {
  act(() => {
    deleteObject(doc, id);
  });
}

export function getStickyTextFor(id: string, doc: Y.Doc = boardDoc()): string {
  const text = getStickyText(doc, id);
  if (!text) throw new Error(`no sticky with id ${id}`);
  return text.toString();
}

export async function waitForNotes(count: number): Promise<void> {
  await vi.waitFor(() => {
    if (boardNotes().length !== count) {
      throw new Error(`expected ${count} notes, found ${boardNotes().length}`);
    }
  });
}

/** Press and release on the note itself: selection without a drag. */
export async function selectNote(id: string): Promise<void> {
  await click(noteCentreOnScreen(id), noteElement(id));
}

/** Double-click the note: it becomes the note being edited. */
export async function startEditingNote(id: string): Promise<void> {
  doubleClick(noteCentreOnScreen(id), noteElement(id));
  await flushFrames();
}

/** Drag the note by (dx, dy) screen pixels from its centre. */
export async function dragNote(
  id: string,
  delta: { x: number; y: number },
  steps = 3,
): Promise<void> {
  const from = noteCentreOnScreen(id);
  await drag(noteElement(id), from, { x: from.x + delta.x, y: from.y + delta.y }, steps);
}

/** Change a note through the document, the way another browser would (story 3). */
export function remotePatch(
  id: string,
  patch: { x?: number; y?: number; z?: number; color?: string },
  doc: Y.Doc = boardDoc(),
): void {
  act(() => {
    doc.transact(() => {
      const object = doc.getMap('objects').get(id);
      if (!object) throw new Error(`no object with id ${id} in the document`);
      const map = object as unknown as { set(key: string, value: unknown): void };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) map.set(key, value);
      }
    });
  });
}

/** Replace a note's text through the document, the way another browser would. */
export function remoteSetText(id: string, text: string, doc: Y.Doc = boardDoc()): void {
  act(() => {
    doc.transact(() => {
      const yText = getStickyText(doc, id);
      if (!yText) throw new Error(`no sticky with id ${id} in the document`);
      const existing = yText.toString();
      if (existing.length > 0) yText.delete(0, existing.length);
      if (text.length > 0) yText.insert(0, text);
    });
  });
}
