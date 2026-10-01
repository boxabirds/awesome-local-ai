// Shared helpers for the jsdom component tests: render the whole app, flush the
// requestAnimationFrame-batched camera updates with fake timers, and read the
// camera / grid / transform the board rendered.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import App from '../../src/client/App';
import {
  initDoc,
  createSticky,
  getStickyText,
  snapshotByCreation,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { HANDLE_SIZE_PX } from '../../src/shared/config';
import {
  createText,
  getTextContent,
  textSnapshot,
  textSnapshots,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import type {
  CloseEventLike,
  ConnectionEmitter,
  ConnectionState,
} from '../../src/client/sync/connectBoard';
import { resetCamera, type Camera, type Point, type Size } from '../../src/client/canvas/camera';

function number(value: string | undefined): number {
  if (value === undefined) throw new Error('missing data attribute');
  return Number(value);
}

/** Render the app and return the board's DOM handles. */
export function renderBoard(options: { doc?: Y.Doc } = {}) {
  const doc = options.doc ?? new Y.Doc();
  initDoc(doc);
  const utils = render(<App doc={doc} />);
  return { ...utils, doc };
}

/** The board area size the app measured (jsdom has no ResizeObserver). */
export function boardSize(): Size {
  const value = screen.getByTestId('board-area').dataset.viewport;
  const match = /^(-?[\d.]+)x(-?[\d.]+)$/.exec(value ?? '');
  if (match === null) throw new Error(`unparsable data-viewport: ${value}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** The camera as rendered by the board (data attributes on the viewport). */
export function readCamera(): Camera {
  const el = screen.getByTestId('board-viewport');
  return {
    x: number(el.dataset.cameraX),
    y: number(el.dataset.cameraY),
    zoom: number(el.dataset.cameraZoom),
  };
}

/** Camera the board starts with: Reset view for the measured board size. */
export function initialCamera(): Camera {
  return resetCamera(boardSize());
}

export function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

export function worldEl(): HTMLElement {
  return screen.getByTestId('board-world');
}

/** The world layer's inline transform, as numbers. */
export function worldTransform(): { scale: number; translateX: number; translateY: number } {
  const transform = worldEl().style.transform;
  const match = /scale\(([-\d.e+]+)\)\s*translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/.exec(
    transform,
  );
  if (match === null) throw new Error(`unparsable transform: ${transform}`);
  return {
    scale: Number(match[1]),
    translateX: Number(match[2]),
    translateY: Number(match[3]),
  };
}

/** Dot-grid geometry as computed by the board (CSS pixels). */
export function gridGeometry(): {
  spacing: number;
  offsetX: number;
  offsetY: number;
  cssSize: string;
  cssPosition: string;
} {
  const el = viewportEl();
  const computed = getComputedStyle(el);
  return {
    spacing: number(el.dataset.gridSpacing),
    offsetX: number(el.dataset.gridOffsetX),
    offsetY: number(el.dataset.gridOffsetY),
    // the CSS the browser actually renders with
    cssSize: computed.backgroundSize,
    cssPosition: computed.backgroundPosition,
  };
}

export function mode(): string {
  return viewportEl().dataset.mode ?? '';
}

export function zoomLabel(): string {
  return screen.getByTestId('zoom-label').textContent ?? '';
}

export function hintVisible(): boolean {
  return screen.queryByTestId('nav-hint') !== null;
}

export function hintText(): string | null {
  return screen.queryByTestId('nav-hint')?.textContent ?? null;
}

/**
 * Flush the camera update: the board coalesces camera changes into one
 * requestAnimationFrame, so advance a couple of frames inside act().
 */
export function flushFrames(frames = 2): void {
  act(() => {
    vi.advanceTimersByTime(16 * frames);
  });
}

export function pointerDown(p: Point, init: Record<string, unknown> = {}): void {
  fireEvent.pointerDown(viewportEl(), {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
    ...init,
  });
}

export function pointerMove(p: Point, init: Record<string, unknown> = {}): void {
  fireEvent.pointerMove(viewportEl(), {
    pointerId: 1,
    pointerType: 'mouse',
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
    ...init,
  });
}

export function pointerUp(p: Point, init: Record<string, unknown> = {}): void {
  fireEvent.pointerUp(viewportEl(), {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    clientX: p.x,
    clientY: p.y,
    ...init,
  });
}

/** Drag the board from one screen point to another in several pointermove steps. */
export function dragTo(from: Point, to: Point, steps = 4): void {
  pointerDown(from);
  flushFrames();
  for (let i = 1; i <= steps; i++) {
    pointerMove({
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
    flushFrames();
  }
  pointerUp(to);
  flushFrames();
}

export function wheelAt(
  target: Element,
  init: { deltaX?: number; deltaY?: number; deltaMode?: number; ctrlKey?: boolean; metaKey?: boolean; clientX?: number; clientY?: number },
): Event {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    deltaMode: init.deltaMode ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  target.dispatchEvent(event);
  return event;
}

/** Safari gesture event (not standardised; jsdom has no constructor for it). */
export function gestureAt(
  target: Element,
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  point: Point,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  Object.defineProperty(event, 'rotation', { value: 0 });
  Object.defineProperty(event, 'clientX', { value: point.x });
  Object.defineProperty(event, 'clientY', { value: point.y });
  target.dispatchEvent(event);
  return event;
}

export function pressKey(key: string, init: { ctrlKey?: boolean; metaKey?: boolean } = {}): Event {
  let event!: Event;
  // act(): the board's keyboard handlers change React state (selection) and the
  // document, and the test reads the result straight after
  act(() => {
    event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
    });
    // The board listens on window, the way browser zoom shortcuts arrive.
    window.dispatchEvent(event);
  });
  return event;
}

/**
 * Install fake timers. Vitest's fake timers also replace requestAnimationFrame,
 * which is how the board coalesces camera updates into one render per frame.
 */
export function installFakeFrames(): void {
  vi.useFakeTimers();
}

export function useBoardTestLifecycle(): void {
  beforeEach(() => {
    installFakeFrames();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
}

// --------------------------------------------------------------------------------
// Sticky note helpers (story 2)
// --------------------------------------------------------------------------------

const byTestId = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const allTestId = (id: string): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));

/** The notes in the order the board paints them: the last one is on top. */
export function noteElements(): HTMLElement[] {
  return allTestId('sticky-note');
}

export function noteAt(index: number): HTMLElement {
  const el = noteElements()[index];
  if (el === undefined) throw new Error(`no note at index ${index} (${noteElements().length} rendered)`);
  return el;
}

export function noteCount(): number {
  return noteElements().length;
}

/** Where a note is, read back from the document through the rendered element. */
export function notePosition(index: number): { x: number; y: number } {
  const el = noteAt(index);
  return { x: Number(el.dataset.noteX), y: Number(el.dataset.noteY) };
}

/** Note id and z in document order, which is the order they were created in. */
export function noteOrder(): { id: string; z: number }[] {
  return noteElements().map((el) => ({ id: String(el.dataset.noteId), z: Number(el.dataset.noteZ) }));
}

/**
 * The order the browser paints the notes in, bottom first: every note gets one
 * element and they are stacked by z-index, so the last of these is the note that
 * is drawn on top of the others.
 */
export function paintOrder(): { id: string; z: number; css: number }[] {
  return noteElements()
    .map((el, position) => ({
      id: String(el.dataset.noteId),
      z: Number(el.dataset.noteZ),
      css: Number(el.style.zIndex),
      position,
    }))
    .sort((a, b) => a.css - b.css || a.position - b.position)
    .map(({ id, z, css }) => ({ id, z, css }));
}

/** Notes carrying the selection outline. */
export function selectedNotes(): HTMLElement[] {
  return noteElements().filter((el) => el.dataset.selected === 'true');
}

export function selectionCount(): number {
  return selectedNotes().length;
}

/** The text of a note: a div while reading, a textarea while typing. */
export function textElement(index: number): HTMLElement | null {
  return noteAt(index).querySelector<HTMLElement>('[data-testid="sticky-text"]');
}

export function noteText(index: number): string {
  return textElement(index)?.textContent ?? '';
}

export function noteFontPx(index: number): number {
  return Number(textElement(index)?.dataset.fontPx ?? NaN);
}

export function noteOverflows(index: number): boolean {
  return textElement(index)?.dataset.overflow === 'true';
}

export function fadeElement(index: number): HTMLElement | null {
  return noteAt(index).querySelector<HTMLElement>('[data-testid="sticky-fade"]');
}

/** The open editor, or null when nothing is being typed in. */
export function editorElement(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('textarea[data-testid="sticky-text"]');
}

export function isEditing(): boolean {
  return editorElement() !== null;
}

export function editorValue(): string {
  return editorElement()?.value ?? '';
}

export function editorFocused(): boolean {
  return document.activeElement === editorElement();
}

export const noteToolbarElement = (): HTMLElement | null => byTestId('note-toolbar');
export const swatchElement = (color: string): HTMLElement | null => byTestId(`swatch-${color}`);
export const deleteNoteButton = (): HTMLElement | null => byTestId('delete-note');
export const stickyToolButton = (): HTMLElement | null => byTestId('create-sticky');
export const counterElement = (): HTMLElement | null => byTestId('sticky-counter');
export const noteToolbarOpen = (): boolean => noteToolbarElement() !== null;

function pointerOn(
  el: Element,
  kind: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'click' | 'dblclick',
  init: Record<string, unknown> = {},
): void {
  const released = kind === 'pointerup' || kind === 'pointercancel';
  const init2: Record<string, unknown> = {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    buttons: released || kind === 'click' || kind === 'dblclick' ? 0 : 1,
    clientX: 0,
    clientY: 0,
    ...init,
  };
  if (kind === 'pointerdown') init2.button = 0;
  if (kind === 'pointerup') init2.button = 0;
  switch (kind) {
    case 'pointerdown':
      fireEvent.pointerDown(el, init2);
      return;
    case 'pointermove':
      fireEvent.pointerMove(el, init2);
      return;
    case 'pointerup':
      fireEvent.pointerUp(el, init2);
      return;
    case 'pointercancel':
      fireEvent.pointerCancel(el, init2);
      return;
    case 'click':
      fireEvent.click(el, init2);
      return;
    case 'dblclick':
      fireEvent.doubleClick(el, init2);
      return;
  }
}

/** One pointer event on any element, with the fields a real pointer event has. */
export { pointerOn };

/** A press that ends where it started: a click for the note, not a drag. */
export function clickOn(el: Element | null, clientX = 10, clientY = 10): void {
  if (el === null) throw new Error('clickOn: the element is missing');
  pointerOn(el, 'pointerdown', { clientX, clientY });
  pointerOn(el, 'pointerup', { clientX, clientY });
  fireEvent.click(el, { clientX, clientY });
}

/** The two clicks of a double-click, in the order a browser sends them. */
export function doubleClickOn(el: Element | null, clientX = 10, clientY = 10): void {
  if (el === null) throw new Error('doubleClickOn: the element is missing');
  pointerOn(el, 'pointerdown', { clientX, clientY });
  pointerOn(el, 'pointerup', { clientX, clientY });
  fireEvent.click(el, { clientX, clientY, detail: 2 });
  fireEvent.doubleClick(el, { clientX, clientY, detail: 2 });
}

/**
 * Drag a note by (dx, dy) screen pixels in `steps` moves, flushing the animation
 * frames the note's writes are batched into between each.
 */
export function dragNote(index: number, dx: number, dy: number, steps = 4): void {
  const el = noteAt(index);
  pointerOn(el, 'pointerdown', { clientX: 20, clientY: 20 });
  for (let i = 1; i <= steps; i += 1) {
    pointerOn(el, 'pointermove', { clientX: 20 + (dx * i) / steps, clientY: 20 + (dy * i) / steps });
    flushFrames();
  }
  pointerOn(el, 'pointerup', { clientX: 20 + dx, clientY: 20 + dy });
  flushFrames();
}

/** A press on the board surface itself: a click on empty space, or a pan. */
export function clickBoard(clientX = 500, clientY = 400): void {
  const el = viewportEl();
  pointerOn(el, 'pointerdown', { clientX, clientY });
  pointerOn(el, 'pointerup', { clientX, clientY });
  fireEvent.click(el, { clientX, clientY });
}

/** Double-click the board surface itself (empty space). */
export function doubleClickBoard(clientX = 500, clientY = 400): void {
  doubleClickOn(viewportEl(), clientX, clientY);
}

/** Add a note through the model, the way the app does, and return its id. */
export function newNote(doc: Y.Doc, world: { x: number; y: number } = { x: 0, y: 0 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, world);
  });
  return id;
}

/** Give a note text from the test side (what typing would have written). */
export function setNoteText(doc: Y.Doc, id: string, text: string): void {
  act(() => {
    getStickyText(doc, id)?.insert(0, text);
  });
}

/** The document's text for a note id, as it stands right now. */
export function modelText(doc: Y.Doc, id: string): string {
  return getStickyText(doc, id)?.toString() ?? '';
}

/** Put text in the open editor the way a paste arrives: one value, one event. */
export function typeInto(value: string): void {
  const el = editorElement();
  if (el === null) throw new Error('typeInto: no note is being edited');
  act(() => {
    fireEvent.input(el, { target: { value } });
  });
}

/**
 * Press a key where the browser would: on the focused element, up to window.
 * The modifiers are optional, so every story-2 call site still reads the same.
 */
export function pressKeyOn(
  target: EventTarget | Element | null,
  key: string,
  init: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): Event {
  if (target === null) throw new Error(`pressKeyOn: element is missing for ${key}`);
  let event!: Event;
  act(() => {
    event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
      shiftKey: init.shiftKey ?? false,
    });
    target.dispatchEvent(event);
  });
  return event;
}

/**
 * jsdom does no text layout, so a test says how tall the rendered text is
 * instead of trusting the browser to measure it.
 */
export function stubTextHeight(height: number | ((fontPx: number) => number)): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      const fontPx = Number.parseFloat(this.style.fontSize);
      if (!Number.isFinite(fontPx)) return 0;
      return typeof height === 'number' ? height : height(fontPx);
    },
  });
}

/** Give up the pretend layout (each test restores jsdom's own answer). */
export function unstubTextHeight(): void {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
}

/** The world point in the middle of the visible board area, right now. */
export function screenCentre(): { x: number; y: number } {
  const size = boardSize();
  const camera = readCamera();
  return {
    x: size.width / 2 / camera.zoom + camera.x,
    y: size.height / 2 / camera.zoom + camera.y,
  };
}

// --------------------------------------------------------------------------------
// Connection badge helpers (story 4)
// --------------------------------------------------------------------------------

/**
 * A hand-driven stand-in for the provider's event surface, so a test can say
 * exactly what the connection did: `emitStatus`, `emitSync`, `emitClose`.
 */
export class FakeConnectionEmitter implements ConnectionEmitter {
  private statusHandlers: ((e: { status: string }) => void)[] = [];
  private syncHandlers: ((s: boolean) => void)[] = [];
  private closeHandlers: ((e: CloseEventLike | null) => void)[] = [];

  on(name: 'status' | 'sync' | 'connection-close', handler: (arg: never) => void): void {
    (name === 'status' ? this.statusHandlers : name === 'sync' ? this.syncHandlers : this.closeHandlers).push(
      handler as never,
    );
  }

  off(name: 'status' | 'sync' | 'connection-close', handler: (arg: never) => void): void {
    const list =
      name === 'status' ? this.statusHandlers : name === 'sync' ? this.syncHandlers : this.closeHandlers;
    const i = list.indexOf(handler as never);
    if (i >= 0) list.splice(i, 1);
  }

  emitStatus(status: string): void {
    for (const handler of [...this.statusHandlers]) handler({ status });
  }

  emitSync(synced: boolean): void {
    for (const handler of [...this.syncHandlers]) handler(synced);
  }

  /** A close the server sent. `null` is a connection closed locally. */
  emitClose(code: number | null): void {
    for (const handler of [...this.closeHandlers]) handler(code === null ? null : { code });
  }
}

/**
 * Say what the connection state is, for tests of what the board *does* with a
 * state (the edit lock, the message it shows). The mapping from the room's close
 * codes to a state is tested against the provider's events, not here.
 */
export function forceConnectionState(state: ConnectionState): void {
  const api = window.__vidi6 as unknown as
    | { __forceConnectionState?(next: ConnectionState): void }
    | undefined;
  if (typeof api?.__forceConnectionState !== 'function') {
    throw new Error('the test build is missing __forceConnectionState');
  }
  act(() => {
    api.__forceConnectionState?.(state);
  });
}

// --------------------------------------------------------------------------------
// Text object helpers (story 9)
// --------------------------------------------------------------------------------

/** The text objects, in the order the board builds them. */
export function textElements(): HTMLElement[] {
  return allTestId('text-object');
}

export function textAt(index: number): HTMLElement {
  const el = textElements()[index];
  if (el === undefined) {
    throw new Error(`no text at index ${index} (${textElements().length} rendered)`);
  }
  return el;
}

export function textCount(): number {
  return textElements().length;
}

function px(value: string): number {
  return Number.parseFloat(value);
}

/**
 * The box the board paints for a text object, in world units: the box the model
 * stored, placed by the camera. This is what a test asserts when it wants to know
 * what the layout decided, because the layout's answer is stored rather than
 * measured at paint time.
 */
export function textBox(index: number): { x: number; y: number; width: number; height: number } {
  const style = textAt(index).style;
  return { x: px(style.left), y: px(style.top), width: px(style.width), height: px(style.height) };
}

export function textSizeOf(index: number): string {
  return String(textAt(index).dataset.size);
}

export function textWidthModeOf(index: number): string {
  return String(textAt(index).dataset.widthMode);
}

export function textFontPxOf(index: number): number {
  return Number(textAt(index).dataset.fontPx);
}

/** The lines the board renders for a text, in order. */
export function textBodyLines(index: number): string[] {
  return Array.from(textAt(index).querySelectorAll<HTMLElement>('[data-testid="text-line"]')).map(
    (el) => el.textContent ?? '',
  );
}

/** Text objects carrying the selection outline. */
export function selectedTexts(): HTMLElement[] {
  return textElements().filter((el) => el.dataset.selected === 'true');
}

/** The open text editor, whichever object it belongs to. */
export function textEditorElement(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('textarea[data-testid="text-editor"]');
}

/** Any open editor, of either type: the board has one caret at a time. */
export function anyEditorOpen(): boolean {
  return document.querySelector('textarea[data-testid="sticky-text"], textarea[data-testid="text-editor"]') !== null;
}

export const textToolSelectButton = (): HTMLElement | null => byTestId('tool-select');
export const textToolTextButton = (): HTMLElement | null => byTestId('tool-text');
/** The layer the Text tool puts over the board, or null while it is held down. */
export const textToolLayer = (): HTMLElement | null => byTestId('text-tool-layer');
export const textToolbarElement = (): HTMLElement | null => byTestId('text-toolbar');
export const textSizeButton = (size: string): HTMLElement | null => byTestId(`text-size-${size}`);
export const textToolbarDelete = (): HTMLElement | null => byTestId('text-toolbar-delete');

/** Every resize handle now on screen, by name. */
export function handlesShown(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="resize-handle-"]')).map(
    (el) => String(el.getAttribute('data-testid')).replace('resize-handle-', ''),
  );
}

export const selectionBarElement = (): HTMLElement | null => byTestId('selection-bar');

/** Add a text through the model, the way the app does, and return its id. */
export function newText(doc: Y.Doc, world: { x: number; y: number } = { x: 0, y: 0 }): string {
  let id: string | null = null;
  act(() => {
    id = createText(doc, world, 'g_test_creator');
  });
  if (id === null) throw new Error('newText: the model refused the point');
  return id;
}

/** Text arriving in a text object, and the box that goes with it. */
export function newTextWithText(
  doc: Y.Doc,
  world: { x: number; y: number } = { x: 0, y: 0 },
  text = 'Faster onboarding',
): string {
  const id = newText(doc, world);
  act(() => {
    getTextContent(doc, id)?.insert(0, text);
  });
  return id;
}

/**
 * A change that arrived from elsewhere: the same write to the same shared type,
 * with an origin the local undo manager does not track, which is how a remote
 * person's keystroke reaches this document.
 */
export function remoteTextEdit(doc: Y.Doc, id: string, text: string, index = 0): void {
  act(() => {
    doc.transact(() => {
      getTextContent(doc, id)?.insert(index, text);
    }, 'from-another-person');
  });
}

/** What the document holds for a text object, or null when it has no box. */
export function storedBox(
  doc: Y.Doc,
  id: string,
): { x: number; y: number; width: number; height: number; size: string; widthMode: string } | null {
  const snap = textSnapshot(doc, id);
  if (snap === null) return null;
  return {
    x: snap.x,
    y: snap.y,
    width: snap.width,
    height: snap.height,
    size: snap.size,
    widthMode: snap.widthMode,
  };
}

/** The text a text object holds. */
export function modelTextOf(doc: Y.Doc, id: string): string {
  return getTextContent(doc, id)?.toString() ?? '';
}

/**
 * Run something and count how many transactions changed this object's stored
 * width or height. That is the question a layout test has to ask: a board where
 * every client measures for itself writes a box that never settles, and the only
 * proof that it does not is that nobody wrote one.
 */
export function countBoxWrites(doc: Y.Doc, id: string, run: () => void): number {
  // The stored box as one comparable string. A transaction that leaves both
  // numbers as they were is not a write, which is the difference between a board
  // that settles and one whose clients keep measuring over each other.
  const box = (): string => {
    const object = doc.getMap<Y.Map<unknown>>('objects').get(id);
    return object === undefined ? 'gone' : `${String(object.get('width'))}|${String(object.get('height'))}`;
  };
  let writes = 0;
  let previous = box();
  const onTransact = (): void => {
    const next = box();
    if (next !== previous) writes += 1;
    previous = next;
  };
  // 'afterTransaction' fires once per transaction, which is the unit a remote
  // client receives: the box either changed in that transaction or it did not.
  doc.on('afterTransaction', onTransact);
  try {
    run();
  } finally {
    doc.off('afterTransaction', onTransact);
  }
  return writes;
}

/** A press-and-release on the Text tool's layer: the click that places text. */
export function clickTextToolLayer(clientX = 300, clientY = 200): void {
  const layer = textToolLayer();
  if (layer === null) throw new Error('clickTextToolLayer: the Text tool is not held');
  pointerOn(layer, 'pointerdown', { clientX, clientY });
  pointerOn(layer, 'pointerup', { clientX, clientY });
  fireEvent.click(layer, { clientX, clientY });
}

/** Hold the Text tool the way the keyboard does. */
export function holdTextTool(): void {
  pressKey('t');
}
/** Put text in the open text editor the way a paste or a keystroke arrives. */
export function typeIntoText(value: string): void {
  const el = textEditorElement();
  if (el === null) throw new Error('typeIntoText: no text object is being edited');
  act(() => {
    fireEvent.input(el, { target: { value } });
  });
}

/**
 * Grab one named resize handle of the selection box and drag it. The handle's own
 * centre is the grab point, and the move and release go to the window, which is
 * where a real drag ends up once the pointer outruns an eight-pixel handle.
 */
export function dragHandle(handle: string, dx: number, dy: number): void {
  const el = byTestId(`resize-handle-${handle}`);
  if (el === null) throw new Error(`dragHandle: no ${handle} handle on screen`);
  const cx = px(el.style.left) + HANDLE_SIZE_PX / 2;
  const cy = px(el.style.top) + HANDLE_SIZE_PX / 2;
  pointerOn(el, 'pointerdown', { clientX: cx, clientY: cy });
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: cx + dx, clientY: cy + dy });
  flushFrames();
  fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: cx + dx, clientY: cy + dy });
  flushFrames();
}

/** Delete an object the way a person elsewhere on the board does it. */
export function remoteDelete(doc: Y.Doc, id: string): void {
  act(() => {
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>('objects').delete(id);
    }, 'from-another-person');
  });
}
/**
 * Every object on the board, of every type: notes then texts, each group in
 * creation order - the same list the board builds its elements from, and the one
 * the end-to-end hook hands to a test.
 */
export function allObjects(doc: Y.Doc): (StickySnapshot | TextSnapshot)[] {
  return [...snapshotByCreation(doc), ...textSnapshots(doc)];
}

/** The text objects on the board, in creation order. */
export function snapshotTexts(doc: Y.Doc): TextSnapshot[] {
  return [...textSnapshots(doc)];
}
