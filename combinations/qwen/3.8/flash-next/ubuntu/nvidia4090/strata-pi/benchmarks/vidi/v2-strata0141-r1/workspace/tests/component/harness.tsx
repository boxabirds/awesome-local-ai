import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardView } from '../../src/client/board/BoardView';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import type { BoardProvider } from '../../src/client/sync/connectBoard';
import type { Camera } from '../../src/client/canvas/camera';
import type { StickyColor } from '../../src/shared/config';

/** A board address for component runs: no room is contacted, but the address is real. */
export const COMPONENT_BOARD_ID = 'componentboard00000000';

/**
 * Render the full board. With a `doc`, the caller inspects the exact Y.Doc the
 * UI writes to; without one the board creates its own. Component runs never
 * open a socket (`connect: false`): the room is covered by the integration suite.
 */
export function renderBoard(
  options: {
    doc?: Y.Doc;
    boardId?: string;
    connect?: boolean;
    providerFactory?: (url: string, boardId: string, doc: Y.Doc) => BoardProvider;
    /** Gesture boundary spies (`sel.transform`, and story 8's undo boundary). */
    onTransformStart?: () => void;
    onTransformEnd?: () => void;
  } = {},
) {
  return render(
    <BoardView
      doc={options.doc}
      boardId={options.boardId ?? COMPONENT_BOARD_ID}
      connect={options.connect ?? false}
      providerFactory={options.providerFactory}
      onTransformStart={options.onTransformStart}
      onTransformEnd={options.onTransformEnd}
    />,
  );
}

/** Let the requestAnimationFrame-batched camera update land. */
export async function flushFrame(): Promise<void> {
  await act(async () => {
    if (typeof requestAnimationFrame === 'function') {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

export function boardElement(): HTMLElement {
  return screen.getByTestId('board');
}

export function worldLayer(): HTMLElement {
  return screen.getByTestId('world-layer');
}

/** Read the camera back from the rendered world-layer transform. */
export function readCamera(): Camera {
  const transform = worldLayer().style.transform;
  const match = /scale\(([-0-9.e+]+)\)\s*translate\(([-0-9.e+]+)px,\s*([-0-9.e+]+)px\)/u.exec(
    transform,
  );
  if (!match) {
    throw new Error(`unexpected world layer transform: ${JSON.stringify(transform)}`);
  }
  return { x: -Number(match[2]), y: -Number(match[3]), zoom: Number(match[1]) };
}

/** A world point as the screen shows it, with the camera the board is using. */
export function screenOf(point: { x: number; y: number }): { x: number; y: number } {
  const cam = readCamera();
  return { x: (point.x - cam.x) * cam.zoom, y: (point.y - cam.y) * cam.zoom };
}

/** A screen point as the board reads it. */
export function worldOf(point: { x: number; y: number }): { x: number; y: number } {
  const cam = readCamera();
  return { x: point.x / cam.zoom + cam.x, y: point.y / cam.zoom + cam.y };
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The screen rectangle a world rectangle occupies on the rendered board. */
export function screenRectOf(rect: { x: number; y: number; width: number; height: number }): ScreenRect {
  const a = screenOf({ x: rect.x, y: rect.y });
  const b = screenOf({ x: rect.x + rect.width, y: rect.y + rect.height });
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** The centre of a world rectangle, in screen coordinates: where to press it. */
export function screenCentre(rect: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return screenOf({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
}

export function zoomLabel(): string {
  return screen.getByTestId('zoom-percent').textContent ?? '';
}

export function gridStyle(): { size: string; position: string } {
  const style = boardElement().style;
  return { size: style.backgroundSize, position: style.backgroundPosition };
}

export interface GridStyle {
  spacingPx: number;
  offsetX: number;
  offsetY: number;
}

/** The rendered dot pattern as numbers (spacing and tile offset in CSS px). */
export function readGrid(): GridStyle {
  const style = gridStyle();
  const [spacingPx] = style.size.split(' ').map(parseFloat);
  const [offsetX, offsetY] = style.position.split(' ').map(parseFloat);
  return { spacingPx: spacingPx!, offsetX: offsetX!, offsetY: offsetY! };
}

/**
 * Distance between a screen coordinate and the nearest grid dot.
 * CSS paints each dot at the centre of its tile, so a world coordinate that is a
 * multiple of GRID_SPACING_WORLD must land exactly `spacingPx / 2` past the
 * reported background position.
 */
export function dotAlignmentError(
  screenCoord: number,
  offset: number,
  spacingPx: number,
): number {
  const residue = mod(screenCoord - offset, spacingPx);
  return Math.abs(residue - spacingPx / 2);
}

export const mod = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus;

export function pointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  x: number,
  y: number,
): void {
  const target = boardElement();
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 };
  if (typeof PointerEvent === 'function') {
    fireEvent(
      target,
      new PointerEvent(type, { ...init, pointerType: 'mouse', button: 0, isPrimary: true }),
    );
    return;
  }
  const fallback =
    type === 'pointerdown'
      ? 'pointerDown'
      : type === 'pointermove'
        ? 'pointerMove'
        : type === 'pointerup'
          ? 'pointerUp'
          : type === 'pointercancel'
            ? 'pointerCancel'
            : 'lostPointerCapture';
  fireEvent[fallback](target, init as PointerEventInit);
}

export function dispatchWheel(
  target: Element,
  init: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    clientX?: number;
    clientY?: number;
  },
): WheelEvent {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

export function dispatchGesture(
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  boardElement().dispatchEvent(event);
  return event;
}

export function pressKeys(key: string, modifiers: { ctrl?: boolean; meta?: boolean } = {}): Event {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
  });
  window.dispatchEvent(event);
  return event;
}

/**
 * Press a key the way a browser does: the keydown is delivered to the element
 * that has focus (and bubbles to the window, where the board's own handler
 * listens).
 */
export function pressKey(
  key: string,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    shiftKey: modifiers.shift ?? false,
  });
  const target = document.activeElement;
  act(() => {
    if (target instanceof HTMLElement && target !== document.body) {
      target.dispatchEvent(event);
    } else {
      // Nothing is focused: a browser delivers the key to the body, and it
      // bubbles through the document to the window, which is where the board's
      // own listeners sit (and where a marquee's Escape sits on `document`).
      document.body.dispatchEvent(event);
    }
  });
  return event;
}

/** Focus a rendered sticky note (Tab reaches notes: they are focusable). */
export function focusNote(id: string): void {
  noteElement(id).focus();
}

/* ------------------------------------------------------------------------- */
/* Sticky note helpers (story 2)                                             */
/* ------------------------------------------------------------------------- */

/**
 * Board-model mutations run inside `act`, so the Y.Doc update notification is
 * flushed into the rendered notes before the assertion that follows.
 */
export function createNote(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: StickyColor,
): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at, color);
  });
  return id;
}

export function deleteNote(doc: Y.Doc, id: string): void {
  act(() => {
    deleteObject(doc, id);
  });
}

export function moveNote(doc: Y.Doc, id: string, x: number, y: number): void {
  act(() => {
    moveObject(doc, id, x, y);
  });
}

export function editNoteText(doc: Y.Doc, id: string, text: string): void {
  act(() => {
    const ytext = getStickyText(doc, id);
    if (ytext) {
      ytext.doc?.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, text);
      });
    }
  });
}

export interface PointerOptions {
  pointerId?: number;
  button?: number;
  pointerType?: string;
  /** Story 7: Shift+drag selects with a marquee, Shift+click toggles. */
  shiftKey?: boolean;
}

/**
 * Dispatch a real pointer event at a chosen element with client coordinates,
 * so a note can be pressed, dragged and released independently of the board.
 */
export function pointerAt(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  x: number,
  y: number,
  options: PointerOptions = {},
): void {
  const init = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: options.pointerId ?? 1,
    shiftKey: options.shiftKey ?? false,
  };
  if (typeof PointerEvent === 'function') {
    fireEvent(
      target,
      new PointerEvent(type, {
        ...init,
        pointerType: options.pointerType ?? 'mouse',
        button: options.button ?? 0,
        isPrimary: true,
      }),
    );
    return;
  }
  const reactName = type
    .split('-')
    .map((part, index) => (index === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join('');
  const fire = fireEvent as unknown as Record<string, (el: Element, init: unknown) => void>;
  fire[reactName]!(target, init);
}

/** Press and release a note without moving: a click. */
export function clickElement(
  element: Element,
  x = 0,
  y = 0,
  options: PointerOptions = {},
): void {
  pointerAt(element, 'pointerdown', x, y, options);
  pointerAt(element, 'pointerup', x, y, options);
}

/**
 * A real double click: two press/release pairs and the dblclick event that
 * browsers deliver after the second release.
 */
export function doubleClickElement(element: Element, x = 0, y = 0): void {
  pointerAt(element, 'pointerdown', x, y);
  pointerAt(element, 'pointerup', x, y);
  fireEvent.click(element, { clientX: x, clientY: y, detail: 1 });
  pointerAt(element, 'pointerdown', x, y);
  pointerAt(element, 'pointerup', x, y);
  fireEvent.dblClick(element, { clientX: x, clientY: y, detail: 2 });
  fireEvent.click(element, { clientX: x, clientY: y, detail: 2 });
}

/** Drag an element: press, move in steps, release. */
export function dragElement(
  element: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 4,
  options: PointerOptions = {},
): void {
  pointerAt(element, 'pointerdown', from.x, from.y, options);
  for (let step = 1; step <= steps; step += 1) {
    pointerAt(
      element,
      'pointermove',
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
      options,
    );
  }
  pointerAt(element, 'pointerup', to.x, to.y, options);
}

export function noteElement(id: string): HTMLElement {
  return screen.getByTestId(`sticky-note-${id}`);
}
export function noteElements(): HTMLElement[] {
  return screen.queryAllByTestId(/^sticky-note-/u);
}

export function editorElement(): HTMLElement | null {
  return screen.queryByTestId('sticky-editor');
}

export function counterElement(): HTMLElement | null {
  return screen.queryByTestId('sticky-counter');
}

export function noteToolbarElement(): HTMLElement | null {
  return screen.queryByTestId('note-toolbar');
}

/** The notes exactly as the document holds them (sorted by z, then id). */
export function docNotes(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc);
}

export function noteOf(doc: Y.Doc, id: string): StickySnapshot {
  const note = snapshot(doc).find((entry) => entry.id === id);
  if (!note) {
    throw new Error(`note ${id} is not in the document`);
  }
  return note;
}

export function notePosition(doc: Y.Doc, id: string): { x: number; y: number } {
  const note = noteOf(doc, id);
  return { x: note.x, y: note.y };
}

export function noteColor(doc: Y.Doc, id: string): StickyColor {
  return noteOf(doc, id).color;
}

export function noteText(doc: Y.Doc, id: string): string {
  return noteOf(doc, id).text;
}

/** Type into the note editor the way a browser reports each input event. */
export function typeIntoEditor(text: string): void {
  const editor = editorElement();
  if (!editor) {
    throw new Error('the note is not being edited');
  }
  const textarea = editor as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: `${textarea.value}${text}` } });
}

/** Replace the editor value outright (a paste). */
export function pasteIntoEditor(text: string): void {
  const editor = editorElement();
  if (!editor) {
    throw new Error('the note is not being edited');
  }
  fireEvent.change(editor as HTMLTextAreaElement, { target: { value: text } });
}

/* ------------------------------------------------------------------------- */
/* Selection helpers (story 7)                                               */
/* ------------------------------------------------------------------------- */

/** What the board says it has selected, read off the rendered board. */
export function selectionCount(): number {
  const value = screen.getByTestId('app').getAttribute('data-selection-count');
  return value === null ? -1 : Number(value);
}

export function selectionBarElement(): HTMLElement | null {
  return screen.queryByTestId('selection-bar');
}

export function selectionCountText(): string {
  return screen.getByTestId('selection-count').textContent ?? '';
}

export function resizeHandleElement(handle: string): HTMLElement {
  return screen.getByTestId(`resize-handle-${handle}`);
}

export function resizeHandles(): HTMLElement[] {
  return screen.queryAllByTestId(/^resize-handle-/u);
}

export function marqueeElement(): HTMLElement | null {
  return screen.queryByTestId('marquee-rect');
}

/** A rendered object of a type the tests registered (see `tests/fixtures`). */
export function objectElement(id: string): HTMLElement {
  return screen.getByTestId(`object-${id}`);
}

/** Run a document mutation and let the board re-render before continuing. */
export function changeDoc(mutation: () => void): void {
  act(() => {
    mutation();
  });
}

/** The position a note is drawn at, read from its CSS transform. */
export function drawnPosition(id: string): { x: number; y: number } {
  const transform = noteElement(id).style.transform;
  const match = /translate\(([-0-9.e+]+)px,\s*([-0-9.e+]+)px\)/u.exec(transform);
  if (!match) {
    throw new Error(`unexpected note transform: ${JSON.stringify(transform)}`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}
