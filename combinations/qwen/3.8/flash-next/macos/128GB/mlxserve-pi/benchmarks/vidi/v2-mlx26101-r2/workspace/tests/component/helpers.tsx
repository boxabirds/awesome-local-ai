import { act, cleanup, fireEvent, render } from '@testing-library/react';

import * as Y from 'yjs';

import { BoardSurface } from '../../src/client/board/BoardSurface.js';
import { newBoardId } from '../../src/shared/board-id.js';
import type { ObjectSnapshot, StickySnapshot } from '../../src/shared/board-model.js';
import { objectBounds } from '../../src/shared/board-model.js';
import type { TextSnapshot } from '../../src/shared/objects/text.js';
import type { ShapeSnap } from '../../src/shared/objects/shape.js';
import type { ConnectorSnap } from '../../src/shared/objects/connector.js';
import type { StrokeSnap } from '../../src/shared/objects/stroke.js';
import { resolveEndpoints } from '../../src/shared/geometry/connector-geometry.js';
import type { Rect } from '../../src/shared/geometry.js';
import type { TextSize } from '../../src/shared/config.js';
import type { Camera, Point } from '../../src/client/canvas/camera.js';
import { worldToScreen, zoomAt } from '../../src/client/canvas/camera.js';
import { STICKY_SIZE_WORLD } from '../../src/shared/config.js';
import { drainFrames } from './setup.js';
import { FakeLink } from './fake-link.js';
import { connectBoard } from '../../src/client/sync/connectBoard.js';
import type { BoardConnector } from '../../src/client/board/useBoardDoc.js';

/** Board area used by component tests (the design's default laptop size). */
export const VIEWPORT = { width: 1280, height: 800 };

/** The standard view: 100% zoom with the board's start centred in the area. */
export const STANDARD_VIEW: Camera = {
  x: -VIEWPORT.width / 2,
  y: -VIEWPORT.height / 2,
  zoom: 1,
};

/** A drag of 200 px right and 100 px down (the PRD's verification). */
export const DRAG: Point = { x: 200, y: 100 };
/** A pointer position away from the centre, used for zoom-at-pointer tests. */
export const POINTER: Point = { x: 300, y: 200 };
/** The centre of the board area: keyboard/button zoom is anchored here. */
export const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
/** Where the wheel gesture is delivered when a test does not say otherwise. */
export const WHEEL_POINT: Point = CENTRE;

/** Zoom about the viewport centre, as the zoom buttons and shortcuts do. */
export const centreZoom = (cam: Camera, factor: number): Camera => zoomAt(cam, CENTRE, factor);

export const board = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="board-viewport"]')!;
export const worldLayer = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-testid="world-layer"]')!;
export const zoomLabel = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="zoom-label"]')!;

/**
 * Camera updates are batched onto the next animation frame (design
 * "camera.hook"), so every dispatched interaction advances that frame before
 * the test looks at the DOM.
 */
function settle(): void {
  act(() => {
    drainFrames();
  });
}

/** Advance the frame queue so queued camera updates are rendered. */
export function flushFrames(): void {
  settle();
}

/**
 * Render the board surface — the stories 1-4 UI, which is what these files are about -
 * and return its fake room link.
 *
 * It renders `BoardSurface` and not `App`, and that is a story 5 consequence rather than
 * a shortcut: `App` is now a router, and the board it shows is behind a question put to a
 * server ("is this board there?"), so rendering `App` here would make every test in these
 * files a test of `fetch` before it was a test of the board. The pages own that question,
 * and `pages.test.tsx` renders them; the wiring of the whole thing is e2e's job.
 */
export function renderBoard(link = new FakeLink()): FakeLink {
  // Tests that loop over several renders would otherwise stack containers.
  cleanup();
  const connect: BoardConnector = (doc, boardId, onState) =>
    connectBoard(doc, boardId, onState, { createLink: () => link });
  activeLink = link;
  act(() => {
    render(<BoardSurface boardId={newBoardId()} connect={connect} />);
  });
  flushFrames();
  return link;
}

/**
 * The board's connection is faked in component tests: a component test that
 * opened a real socket would be testing the network, and jsdom's WebSocket
 * cannot reach the room anyway. `renderBoard` hands the board a fake and remembers
 * it here, so a test can say what the connection did. It reports nothing on its
 * own, which leaves the badge on "Connecting…" - a test that needs a board that
 * is in step with its room says so.
 */
let activeLink: FakeLink | null = null;

/** The connection the last `renderBoard` used. */
export function connectionLink(): FakeLink {
  if (activeLink === null) throw new Error('no app is rendered');
  return activeLink;
}

/** The camera the app currently holds (test hook, present in test mode). */
export function camera(): Camera {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks are not registered');
  return hooks.getCamera();
}

/** Read the rendered world layer transform back into a camera. */
export function renderedCamera(): Camera {
  const match = /scale\(([-0-9.e+]+)\)\s+translate\(([-0-9.e+]+)px,\s*([-0-9.e+]+)px\)/u.exec(
    worldLayer().style.transform,
  );
  if (!match) throw new Error(`unexpected world transform: ${worldLayer().style.transform}`);
  return { x: -Number(match[2]), y: -Number(match[3]), zoom: Number(match[1]) };
}

/** The rendered dot grid: screen spacing and the phase of the lattice. */
export function grid(): { spacing: number; offsetX: number; offsetY: number } {
  const style = board().style;
  const [sizeX] = style.backgroundSize.split(' ');
  const [posX, posY] = style.backgroundPosition.split(' ');
  const spacing = parseFloat(sizeX ?? '');
  const offsetX = parseFloat(posX ?? '');
  const offsetY = parseFloat(posY ?? '0');
  if (!Number.isFinite(spacing) || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    throw new Error(`unexpected grid style: ${style.backgroundSize} / ${style.backgroundPosition}`);
  }
  return { spacing, offsetX, offsetY };
}

const POINTER_ID = 1;

export function pointerDown(p: Point, element: Element = board()): void {
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function pointerMove(p: Point, element: Element = board()): void {
  fireEvent.pointerMove(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function pointerUp(p: Point, element: Element = board()): void {
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function pointerCancel(p: Point, element: Element = board()): void {
  fireEvent.pointerCancel(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function lostPointerCapture(p: Point, element: Element = board()): void {
  fireEvent.lostPointerCapture(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export interface WheelInit {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  point?: Point;
  /** Set false to leave the queued frame undrained (frame batching tests). */
  flush?: boolean;
}

/** Dispatch a cancelable wheel event; check `event.defaultPrevented`. */
export function wheelEvent({
  deltaX = 0,
  deltaY = 0,
  deltaMode = 0,
  ctrlKey = false,
  metaKey = false,
  point = { x: 640, y: 400 },
  flush = true,
}: WheelInit, element: Element = board()): Event {
  const event = new WheelEvent('wheel', {
    deltaX,
    deltaY,
    deltaMode,
    ctrlKey,
    metaKey,
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  if (flush) settle();
  return event;
}

/** Dispatch a Safari gesture event (GestureEvent does not exist in jsdom). */
export function gestureEvent(
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  point: Point = { x: 640, y: 400 },
  element: Element = board(),
): Event {
  const event = new MouseEvent(type, {
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'scale', { configurable: true, value: scale });
  element.dispatchEvent(event);
  settle();
  return event;
}

/** Dispatch a keydown on window (the shortcuts are listened to there). */
export function keydown(
  key: string,
  modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean; flush?: boolean } = {},
): Event {
  const { flush = true } = modifiers;
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  // A shortcut can change board content, and a content change reaches React
  // through the document subscription - which only flushes inside act().
  act(() => {
    window.dispatchEvent(event);
  });
  if (flush) settle();
  return event;
}

/* --------------------------------------------------------- sticky notes */

/** The document the rendered app is using (test hook). */
export function boardDoc(): Y.Doc {
  const hooks = window.__vidi6Board;
  if (!hooks) throw new Error('board test hooks are not registered');
  const doc = hooks.getDoc();
  if (!doc) throw new Error('the app has no board document');
  return doc;
}

/** Every object in the document (any type), as the model sees it, in drawing order. */
export function docNotes(): readonly ObjectSnapshot[] {
  const hooks = window.__vidi6Board;
  if (!hooks) throw new Error('board test hooks are not registered');
  return hooks.getNotes();
}

export function noteElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]'));
}

/** The nth note as drawn (0 is the bottom-most). */
export function noteElement(index = 0): HTMLElement {
  const elements = noteElements();
  const element = elements[index];
  if (!element) throw new Error(`no note rendered at position ${index} of ${elements.length}`);
  return element;
}

export function noteData(index = 0): StickySnapshot {
  const notes = docNotes();
  const note = notes[index] as StickySnapshot | undefined;
  if (!note) throw new Error(`no note in the document at position ${index} of ${notes.length}`);
  return note;
}

export function noteId(index = 0): string {
  return noteData(index).id;
}

/** The note's text as the document holds it. */
export function noteText(index = 0): string {
  return noteData(index).text;
}

/** The note's text as the board draws it (not while editing: then the editor holds it). */
export function renderedNoteText(index = 0): string {
  const text = noteElement(index).querySelector<HTMLElement>('[data-testid="sticky-text"]');
  if (!text) throw new Error('the note renders no text');
  return text.textContent ?? '';
}

export function editor(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"]');
  if (!element) throw new Error('no note is being edited');
  return element;
}

/** The id of the note the app holds selected, read from the rendered notes. */
export function selectedNoteId(): string | null {
  const selected = noteElements().find((note) => note.dataset.selected === 'true');
  return selected?.dataset.noteId ?? null;
}

export function editingNoteId(): string | null {
  const editing = noteElements().find((note) => note.dataset.editing === 'true');
  return editing?.dataset.noteId ?? null;
}

/** Click the Sticky note button in the left toolbar. */
export function clickStickyButton(): void {
  const button = document.querySelector<HTMLElement>('[data-testid="create-sticky-button"]');
  if (!button) throw new Error('the toolbar has no Sticky note button');
  fireEvent.click(button);
  settle();
}

/** Double-click the board surface itself (empty board space). */
export function doubleClickBoard(point: Point = CENTRE): void {
  fireEvent.doubleClick(board(), { clientX: point.x, clientY: point.y });
  settle();
}

/** A click on empty board space: pointerdown, pointerup and the click itself. */
export function clickBoard(point: Point = { x: 40, y: 700 }): void {
  pointerDown(point, board());
  pointerUp(point, board());
  fireEvent.click(board(), { clientX: point.x, clientY: point.y });
  settle();
}

/**
 * The same click, on a chosen element instead of the board surface: what a click
 * on an object is, bubbles and all. The board's own click handler sees it, which is
 * how a click on a note can still be a click that means "write here".
 */
export function clickAt(point: Point, element: Element): void {
  pointerDown(point, element);
  pointerUp(point, element);
  fireEvent.click(element, { clientX: point.x, clientY: point.y });
  settle();
}

/**
 * Type into the open editor. The editor is uncontrolled and reads the textarea's
 * own value, so this is what a keystroke does: the browser changes the value,
 * then fires `input`.
 */
export function typeText(value: string): void {
  const element = editor();
  element.value = value;
  fireEvent.input(element, { target: { value } });
  settle();
}

/** Add characters at the end, as typing them would. */
export function typeMore(value: string): void {
  typeText(editor().value + value);
}

/** Text as the open editor holds it. */
export function editorValue(): string {
  return editor().value;
}

/* ------------------------------------------------------------- text objects */

/** The Text tool's button in the left toolbar. */
export function textToolButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>('[data-testid="text-tool-button"]');
  if (!button) throw new Error('the toolbar has no Text tool button');
  return button;
}

/** The Select tool's button in the left toolbar. */
export function selectToolButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>('[data-testid="select-tool-button"]');
  if (!button) throw new Error('the toolbar has no Select tool button');
  return button;
}

/** Which tool the toolbar says is active, by its button's `aria-pressed`. */
export function pressedTool(): 'select' | 'text' | 'shape' | 'connector' | 'pen' | 'neither' {
  const isPressed = (tool: 'select' | 'text' | 'shape' | 'connector' | 'pen'): boolean =>
    document.querySelector<HTMLElement>(`[data-testid="${tool}-tool-button"]`)?.getAttribute('aria-pressed') ===
    'true';
  const active = (['select', 'text', 'shape', 'connector', 'pen'] as const).filter(isPressed);
  if (active.length > 1) throw new Error(`${active.length} tools are pressed at once`);
  return active[0] ?? 'neither';
}

/** Press a tool button (Select, Text, Shape, Connector or Pen). */
export function clickTool(tool: 'select' | 'text' | 'shape' | 'connector' | 'pen'): void {
  const button = document.querySelector<HTMLElement>(`[data-testid="${tool}-tool-button"]`);
  if (!button) throw new Error(`the toolbar has no ${tool} tool button`);
  fireEvent.click(button);
  settle();
}

export function textElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="text-object"]'));
}

/** The nth text object as drawn (0 is the bottom-most). */
export function textElement(index = 0): HTMLElement {
  const elements = textElements();
  const element = elements[index];
  if (!element) throw new Error(`no text rendered at position ${index} of ${elements.length}`);
  return element;
}

/** The nth text object as the document holds it. */
export function textData(index = 0): TextSnapshot {
  const texts = docNotes().filter((object): object is TextSnapshot => object.type === 'text');
  const text = texts[index];
  if (!text) throw new Error(`no text object in the document at position ${index}`);
  return text;
}

export function textId(index = 0): string {
  return textData(index).id;
}

/**
 * The text object's box as the board draws it (the same fallbacks as the canvas),
 * with the two fields that decide how big its words are and how wide it is allowed
 * to get: a test that asserts a box usually also has to say what shape it was in.
 */
export function textBox(index = 0): {
  x: number;
  y: number;
  width: number;
  height: number;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
} {
  const text = textData(index);
  return { ...objectBounds(text), size: text.size, widthMode: text.widthMode };
}

/** The text as the board draws it (not while editing: then the editor holds it). */
export function renderedText(index = 0): string {
  const element = textElement(index).querySelector<HTMLElement>('[data-testid="text-content"]');
  if (!element) throw new Error('the text object renders no text');
  return element.textContent ?? '';
}

/** The open text editor. */
export function textEditor(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]');
  if (!element) throw new Error('no text object is being edited');
  return element;
}

/** Whether a text object's editor is open. */
export function editingTextId(): string | null {
  const editing = textElements().find((element) => element.dataset.editing === 'true');
  return editing?.dataset.objectId ?? null;
}

/** The ids the board holds selected, whatever the objects are. */
export function selectedObjectIds(): string[] {
  const selected = document.querySelectorAll<HTMLElement>(
    '[data-testid="sticky-note"][data-selected="true"], ' +
      '[data-testid="text-object"][data-selected="true"], ' +
      '[data-testid="shape-object"][data-selected="true"], ' +
      '[data-testid="connector-object"][data-selected="true"], ' +
      '[data-testid="stroke-object"][data-selected="true"]',
  );
  return Array.from(selected).map((element) => element.dataset.objectId ?? element.dataset.noteId ?? '');
}

/** Type into the open text object editor. */
export function typeTextValue(value: string): void {
  const element = textEditor();
  element.value = value;
  fireEvent.input(element, { target: { value } });
  settle();
}

/** Add characters at the end of the text object being edited, as typing them would. */
export function typeTextMore(value: string): void {
  typeTextValue(textEditor().value + value);
}

/** The text toolbar (the selection bar's text mode). */
export function textToolbarElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="text-toolbar"]');
}

/** A size button of the text toolbar. */
export function textSizeButton(size: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(
    `[data-testid="text-size-button"][data-size="${size}"]`,
  );
  if (!button) throw new Error(`the text toolbar has no ${size} button`);
  return button;
}

/** Which size the text toolbar says is pressed. */
export function pressedTextSize(): string | null {
  const pressed = document.querySelector<HTMLElement>(
    '[data-testid="text-size-button"][aria-pressed="true"]',
  );
  return pressed?.dataset.size ?? null;
}

/** The handles the selection overlay offers, in the order it draws them. */
export function handleSides(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="resize-handle"]')).map(
    (element) => element.dataset.handle ?? '',
  );
}

/** The resize handle on one side of the selection. */
export function handleElement(side: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="resize-handle"][data-handle="${side}"]`,
  );
  if (!element) throw new Error(`the selection offers no ${side} handle`);
  return element;
}

/**
 * Drag a selection handle: press on it, move in `steps` equal steps, release.
 * The overlay draws its handles in screen pixels, so the points are screen points
 * and the gesture turns them into world units by the zoom it is given.
 */
export function dragHandle(
  side: string,
  from: Point,
  to: Point,
  steps = 4,
): void {
  const element = handleElement(side);
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: from.x,
    clientY: from.y,
  });
  settle();
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    fireEvent.pointerMove(element, {
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      buttons: 1,
      clientX: from.x + (to.x - from.x) * t,
      clientY: from.y + (to.y - from.y) * t,
    });
    settle();
  }
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    button: 0,
    clientX: to.x,
    clientY: to.y,
  });
  settle();
}

/**
 * Drag a note: press on it, move in `steps` equal steps, release. Each step
 * drains the animation frame, which is how the app batches writes (one per
 * frame).
 */
export function dragNote(
  from: Point,
  to: Point,
  element: Element = noteElement(0),
  steps = 4,
): void {
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: from.x,
    clientY: from.y,
  });
  settle();
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    fireEvent.pointerMove(element, {
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      buttons: 1,
      clientX: from.x + (to.x - from.x) * t,
      clientY: from.y + (to.y - from.y) * t,
    });
    settle();
  }
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    button: 0,
    clientX: to.x,
    clientY: to.y,
  });
  settle();
}

/** Press and release on a note without moving (a select). */
export function pressNote(at: Point = { x: 100, y: 100 }, element: Element = noteElement(0)): void {
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: at.x,
    clientY: at.y,
  });
  settle();
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    button: 0,
    clientX: at.x,
    clientY: at.y,
  });
  settle();
}

export function noteToolbarElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="note-toolbar"]');
}

export function colorSwatch(color: string): HTMLElement {
  const swatch = document.querySelector<HTMLElement>(`[data-testid="sticky-color-${color}"]`);
  if (!swatch) throw new Error(`the note toolbar has no ${color} swatch`);
  return swatch;
}

export function binButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>('[data-testid="delete-note"]');
  if (!button) throw new Error('the note toolbar has no delete button');
  return button;
}

/** A note plus its toolbar button, ready for a test about an existing note. */
export function createNote(text = ''): string {
  clickStickyButton();
  const id = noteId(0);
  if (text !== '') typeText(text);
  return id;
}

/**
 * Press a key while a specific element has focus: the event is dispatched on
 * that element and bubbles to the window, which is what a browser does. (The
 * `keydown` helper above dispatches on the window itself, for a shortcut that
 * belongs to the page.)
 */
export function pressKey(key: string, element: Element | Window = window): Event {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  // act(), because the keystroke is handled by React and changes React state:
  // without it the re-render is left queued and the test would read the DOM of
  // the previous state.
  act(() => {
    element.dispatchEvent(event);
  });
  settle();
  return event;
}

/** A pointer press and release on an element at the same point (a select). */
export function pressAt(at: Point, element: Element): void {
  pointerDown(at, element);
  pointerUp(at, element);
}

/** Leave editing through the editor itself (Escape). */
export function escapeFromEditor(): void {
  pressKey('Escape', editor());
}

/** Create a note, type into it, and stop editing: the note ends up selected. */
export function createSelectedNote(text = 'Retro board'): string {
  clickStickyButton();
  if (text !== '') typeText(text);
  escapeFromEditor();
  return noteId(0);
}

/**
 * Where the middle of a note is on screen, in viewport coordinates: what a test
 * has to press to grab that note. Derived from the document and the camera, so a
 * test that drags does not have to re-derive the geometry itself.
 */
export function noteScreenCentre(index = 0): Point {
  const note = noteData(index);
  return worldToScreen(camera(), {
    x: note.x + STICKY_SIZE_WORLD / 2,
    y: note.y + STICKY_SIZE_WORLD / 2,
  });
}

/** Double-click a specific element (an element other than the board surface). */
export function doubleClick(element: Element, point: Point = CENTRE): void {
  fireEvent.doubleClick(element, { clientX: point.x, clientY: point.y });
  settle();
}

/* ------------------------------------------------- connection and editing */

/**
 * The connection badge. Taken by test id rather than by role because the zoom
 * label is a live region too, and a test about the badge does not want to care
 * which of the two it is holding.
 */
export function badge(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="connection-status"]');
  if (!element) throw new Error('the app renders no connection badge');
  return element;
}

/**
 * Whether the board will take an edit.
 *
 * Measured the way a user measures it - is the thing that makes a note available
 * - rather than by calling the app's own `canEdit`, which would pass even if
 * nothing in the interface honoured it. The Sticky note button is the app's one
 * affordance that says "this board accepts new content", so its disabled state
 * is the claim the interface is making.
 */
export function canEdit(): boolean {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-testid="create-sticky-button"]',
  );
  if (!button) throw new Error('the toolbar has no Sticky note button');
  return !button.disabled;
}

/**
 * Every write to the board document from now on. Board content is only ever
 * changed through board-model, and every board-model write makes Yjs emit
 * `update` on the document, so this counts model mutations without reaching
 * into the module - which is what "no mutation happened" has to mean.
 */
export function countDocumentWrites(): { writes: () => number; stop(): void } {
  const doc = boardDoc();
  let writes = 0;
  const listener = (): void => {
    writes += 1;
  };
  doc.on('update', listener);
  return {
    writes: () => writes,
    stop: () => {
      doc.off('update', listener);
    },
  };
}

/* --------------------------------------- story 10: shapes and connector arrows */

/** A button in the toolbar, by its test id. */
function toolbarButton(testId: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!button) throw new Error(`the toolbar has no ${testId} button`);
  return button;
}

export function shapeToolButton(): HTMLElement {
  return toolbarButton('shape-tool-button');
}

export function connectorToolButton(): HTMLElement {
  return toolbarButton('connector-tool-button');
}

/** The three shape kinds, as the Shape button's menu lists them. */
export function shapeKindButtons(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="shape-kind-button"]'));
}

export function shapeKindMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="shape-kind-menu"]');
}

/** Which shape the Shape tool will draw. */
export function pressedShapeKind(): string | null {
  const pressed = shapeKindButtons().find((button) => button.getAttribute('aria-pressed') === 'true');
  return pressed?.getAttribute('data-kind') ?? null;
}

/** Choose the shape the Shape tool draws next. */
export function clickShapeKind(kind: string): void {
  const button = shapeKindButtons().find((candidate) => candidate.getAttribute('data-kind') === kind);
  if (!button) throw new Error(`the shape menu has no ${kind}`);
  fireEvent.click(button);
  settle();
}

/** The tool layer of one drawing tool, which is what its pointer events go to. */
export function toolSurface(tool: 'shape' | 'connector' | 'pen'): HTMLElement {
  const surface = document.querySelector<HTMLElement>(`[data-testid="${tool}-tool-surface"]`);
  if (!surface) throw new Error(`the board renders no ${tool} tool layer`);
  return surface;
}

export function shapeSurface(): HTMLElement {
  return toolSurface('shape');
}

export function connectorSurface(): HTMLElement {
  return toolSurface('connector');
}

/** The pen's own screen: the layer the pointer belongs to while the pen is up. */
export function penSurface(): HTMLElement {
  return toolSurface('pen');
}

/** The tool layer is there only while its tool is the active one. */
export function toolSurfaceExists(tool: 'shape' | 'connector' | 'pen'): boolean {
  return document.querySelector(`[data-testid="${tool}-tool-surface"]`) !== null;
}

export interface DragOptions {
  /** Hold Shift for the whole gesture (a square shape). */
  shift?: boolean;
  /** How many `pointermove` events to send between the press and the release. */
  steps?: number;
  /** Hold Shift only on the last move and the release (Shift pressed mid-drag). */
  shiftFrom?: number;
}

/**
 * A drag on a tool layer: press, move in equal steps, release. Every step drains
 * the frame queue, and the release is the moment the tool writes - so a test that
 * wants to see the preview looks between the moves, not after this returns.
 */
export function dragOnTool(
  tool: 'shape' | 'connector' | 'pen',
  from: Point,
  to: Point,
  options: DragOptions = {},
): void {
  const { shift = false, steps = 4, shiftFrom = null } = options;
  const element = toolSurface(tool);
  const held = (step: number): boolean => shift || (shiftFrom !== null && step >= shiftFrom);
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    shiftKey: held(0),
    clientX: from.x,
    clientY: from.y,
  });
  settle();
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    fireEvent.pointerMove(element, {
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      buttons: 1,
      shiftKey: held(step),
      clientX: from.x + (to.x - from.x) * t,
      clientY: from.y + (to.y - from.y) * t,
    });
    settle();
  }
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    button: 0,
    shiftKey: held(steps + 1),
    clientX: to.x,
    clientY: to.y,
  });
  settle();
}

/** The dashed outline the Shape tool draws while the drag is in the air. */
export function shapePreview(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="shape-preview"]');
}

/** The dashed arrow the Connector tool draws while the drag is in the air. */
export function connectorPreview(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="connector-preview-line"]');
}

/** Every object the tool layer would attach an arrow to, in drawing order. */
export function toolTargets(): readonly ObjectSnapshot[] {
  return docNotes().filter((object) => object.type !== 'connector');
}

/**
 * The topmost object under a world point, which is what the tool layer answers to.
 * The same rule the tool uses, restated here so a test can say "the pointer is over
 * B" without re-deriving it from the fixture.
 */
export function objectAtWorld(point: Point): ObjectSnapshot | null {
  let found: ObjectSnapshot | null = null;
  for (const object of toolTargets()) {
    const rect = objectBounds(object);
    if (point.x < rect.x || point.x > rect.x + rect.width) continue;
    if (point.y < rect.y || point.y > rect.y + rect.height) continue;
    if (found === null || object.z >= found.z) found = object;
  }
  return found;
}

/** Where a world point is on the screen, with the camera the app holds. */
export function screenOf(point: Point): Point {
  return worldToScreen(camera(), point);
}

/** Where a screen point is on the board, with the camera the app holds. */
export function worldOfScreen(point: Point): Point {
  const cam = camera();
  return { x: point.x / cam.zoom + cam.x, y: point.y / cam.zoom + cam.y };
}

/** The four connection dots of one object, as the Connector tool shows them. */
export function connectorDots(objectId?: string): HTMLElement[] {
  const dots = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="connector-dot"]'));
  return objectId === undefined ? dots : dots.filter((dot) => dot.getAttribute('data-object') === objectId);
}

/** The dot the arrow would attach to. */
export function highlightedDot(objectId: string): HTMLElement | null {
  return connectorDots(objectId).find((dot) => dot.getAttribute('data-highlighted') === 'true') ?? null;
}

/* ------------------------------------------------------------------ shapes */

export function shapeElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="shape-object"]'));
}

export function shapeElement(index = 0): HTMLElement {
  const elements = shapeElements();
  const element = elements[index];
  if (!element) throw new Error(`no shape rendered at position ${index} of ${elements.length}`);
  return element;
}

export function shapes(): readonly ShapeSnap[] {
  return docNotes().filter((object): object is ShapeSnap => object.type === 'shape');
}

export function shapeData(index = 0): ShapeSnap {
  const list = shapes();
  const shape = list[index];
  if (!shape) throw new Error(`the board has no shape at position ${index} of ${list.length}`);
  return shape;
}

export function shapeId(index = 0): string {
  return shapeData(index).id;
}

export function shapeLabelElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="shape-label"]'));
}

export function shapeLabel(index = 0): string {
  const element = shapeLabelElements()[index];
  if (!element) throw new Error(`no shape label rendered at position ${index}`);
  return element.textContent ?? '';
}

/** The shape's own editor, open. */
export function shapeEditor(index = 0): HTMLTextAreaElement {
  const elements = Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-testid="shape-label-editor"]'));
  const element = elements[index];
  if (!element) throw new Error(`no shape editor is open at position ${index}`);
  return element;
}

/** Type into a shape's label the way the editor is typed into. */
export function typeShapeText(value: string, index = 0): void {
  const element = shapeEditor(index);
  act(() => {
    element.value = value;
    fireEvent.input(element, { target: { value } });
  });
  settle();
}

/** Where a shape's centre is on the screen. */
export function shapeScreenCentre(index = 0): Point {
  const shape = shapeData(index);
  const rect = objectBounds(shape);
  return screenOf({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
}

/** The selection bar's shape toolbar. */
export function shapeToolbarElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="shape-toolbar"]');
}

export function shapeFillButton(colour: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(`[data-testid="shape-fill-button"][data-color="${colour}"]`);
  if (!button) throw new Error(`the shape toolbar has no ${colour} fill swatch`);
  return button;
}

export function shapeStrokeButton(colour: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(
    `[data-testid="shape-stroke-button"][data-color="${colour}"]`,
  );
  if (!button) throw new Error(`the shape toolbar has no ${colour} outline swatch`);
  return button;
}

export function pressedShapeFill(): string | null {
  return pressedShapeColour('shape-fill-button');
}

export function pressedShapeStroke(): string | null {
  return pressedShapeColour('shape-stroke-button');
}

function pressedShapeColour(testId: string): string | null {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const pressed = buttons.find((button) => button.getAttribute('aria-pressed') === 'true');
  return pressed?.getAttribute('data-color') ?? null;
}

/* -------------------------------------------------------------- connectors */

export function connectorElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="connector-object"]'));
}

export function connectorElement(index = 0): HTMLElement {
  const elements = connectorElements();
  const element = elements[index];
  if (!element) throw new Error(`no connector rendered at position ${index} of ${elements.length}`);
  return element;
}

export function connectors(): readonly ConnectorSnap[] {
  return docNotes().filter((object): object is ConnectorSnap => object.type === 'connector');
}

export function connectorData(index = 0): ConnectorSnap {
  const list = connectors();
  const connector = list[index];
  if (!connector) throw new Error(`the board has no connector at position ${index} of ${list.length}`);
  return connector;
}

/** The two points an arrow is drawn between, according to the document. */
export function connectorEnds(index = 0): { from: Point; to: Point } {
  return resolveEndpoints({ from: connectorData(index).from, to: connectorData(index).to }, rectsOfBoard());
}

/** Every object's live rectangle, as the renderer computes it. */
export function rectsOfBoard(): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of docNotes()) {
    if (object.type === 'connector') continue;
    rects.set(object.id, objectBounds(object));
  }
  return rects;
}

/** The two handles of a selected arrow. */
export function connectorHandleElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="connector-handle"]'));
}

export function connectorHandle(end: 'from' | 'to'): SVGCircleElement {
  const handles = Array.from(document.querySelectorAll<SVGCircleElement>(
    `[data-testid="connector-handle"][data-end="${end}"]`,
  ));
  const handle = handles[0];
  if (!handle) throw new Error(`the selected arrow has no ${end} handle`);
  return handle;
}

/**
 * Where a handle is on the board, in board units: the arrow's own box plus the
 * handle's place in it. Both are inline styles in world units, which is what makes
 * this readable without a layout engine - jsdom lays nothing out, so
 * `getBoundingClientRect` would say the handle is at the origin of the universe.
 */
function handleWorldPoint(handle: SVGCircleElement): Point {
  const box = handle.closest<SVGSVGElement>('[data-testid="connector-object"]');
  if (box === null) throw new Error('a connector handle is drawn outside its arrow');
  return {
    x: parseFloat(box.style.left) + Number(handle.getAttribute('cx') ?? '0'),
    y: parseFloat(box.style.top) + Number(handle.getAttribute('cy') ?? '0'),
  };
}

/**
 * Drag one end handle of a selected arrow to a screen point: press the handle, move
 * in steps (watched on the window, because the pointer leaves the handle at once),
 * release. What the release means - attached, or fixed where it was dropped - is the
 * test's question, not this helper's.
 */
export function dragConnectorHandleToEnd(end: 'from' | 'to', to: Point, steps = 4): void {
  const handle = connectorHandle(end);
  const start = screenOf(handleWorldPoint(handle));
  fireEvent.pointerDown(handle, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
  });
  settle();
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    fireEvent.pointerMove(window, {
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      buttons: 1,
      clientX: start.x + (to.x - start.x) * t,
      clientY: start.y + (to.y - start.y) * t,
    });
    settle();
  }
  fireEvent.pointerUp(window, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    button: 0,
    clientX: to.x,
    clientY: to.y,
  });
  settle();
}

/**
 * Put the camera somewhere else. The hook the e2e tests use to teleport is the one
 * a component test uses too: a wheel gesture would take a hundred events to get to
 * 200%, and the answer would be the same number.
 */
export function setCamera(next: Camera): void {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks are not registered');
  act(() => {
    hooks.setCamera(next);
  });
  flushFrames();
}

/** Zoom to a fraction (0.5 for 50%, 2 for 200%), about the centre of the view. */
export function setZoom(zoom: number): void {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks are not registered');
  setCamera(zoomAt(camera(), CENTRE, zoom / camera().zoom));
}

/** The line a click on an arrow answers, as drawn. */
export function connectorHitElement(index = 0): SVGElement {
  const elements = Array.from(document.querySelectorAll<SVGElement>('[data-testid="connector-hit"]'));
  const element = elements[index];
  if (!element) throw new Error(`no arrow drawn at position ${index} to click`);
  return element;
}

/** Where an arrow's two ends are, in board units, as the board draws them. */
export function connectorScreenEnds(index = 0): { from: Point; to: Point } {
  const ends = connectorEnds(index);
  return { from: screenOf(ends.from), to: screenOf(ends.to) };
}

/* ------------------------------------------------------------- story 11: the pen */

export function penToolButton(): HTMLElement {
  return toolbarButton('pen-tool-button');
}

/** The pen's option bar, which is on the screen only while the pen is the tool. */
export function penToolbarElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="pen-toolbar"]');
}

/** The six inks, in the order the toolbar lists them. */
export function penColorButtons(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="pen-color-button"]'));
}

/** One ink, by its name (`black`, `blue`, ...). */
export function penColorButton(color: string): HTMLElement {
  const button = penColorButtons().find((candidate) => candidate.getAttribute('data-color') === color);
  if (!button) throw error(`the pen toolbar has no ${color} ink`, color);
  return button;
}

/** The three widths, in the order the toolbar lists them. */
export function penThicknessButtons(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="pen-thickness-button"]'));
}

/** One width, by its name (`thin`, `medium`, `thick`). */
export function penThicknessButton(thickness: string): HTMLElement {
  const button = penThicknessButtons().find(
    (candidate) => candidate.getAttribute('data-thickness') === thickness,
  );
  if (!button) throw error(`the pen toolbar has no ${thickness} width`, thickness);
  return button;
}

function error(message: string, wanted: string): Error {
  return new Error(`${message} (asked for "${wanted}")`);
}

/** Which ink the pen toolbar says is chosen, or `null` when the bar is not on screen. */
export function pressedPenColor(): string | null {
  return pressedPenOption('pen-color-button', 'data-color');
}

/** Which width the pen toolbar says is chosen. */
export function pressedPenThickness(): string | null {
  return pressedPenOption('pen-thickness-button', 'data-thickness');
}

function pressedPenOption(testId: string, attribute: string): string | null {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const pressed = buttons.find((button) => button.getAttribute('aria-pressed') === 'true');
  return pressed?.getAttribute(attribute) ?? null;
}

/** Choose the ink the next stroke is drawn with. */
export function clickPenColor(color: string): void {
  fireEvent.click(penColorButton(color));
  settle();
}

/** Choose the pen the next stroke is drawn with. */
export function clickPenThickness(thickness: string): void {
  fireEvent.click(penThicknessButton(thickness));
  settle();
}

/**
 * The line the pen is drawing, and only while it is drawing: the preview lives in
 * this tab's screen and is never in the document, so this element is the whole of
 * what a colleague does *not* see (`pen.share`).
 */
export function penPreview(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="pen-preview"]');
}

/** How many raw points the preview is holding. */
export function penPreviewPoints(): number {
  const preview = penPreview();
  if (preview === null) return 0;
  return Number(preview.getAttribute('data-points') ?? '0');
}

/** The ring that says where the pen is. */
export function penCursor(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="pen-cursor"]');
}

/**
 * A drag along a line someone actually drew: press, walk the points in order, release
 * at the last one. `dragOnTool` walks a straight line between two points, which is the
 * shape of a rectangle and not the shape of a sketch - a stroke needs the turns.
 */
export function dragPenThrough(
  points: readonly Point[],
  options: { steps?: number } = {},
): void {
  if (points.length === 0) throw new Error('a stroke of no points is not a drag');
  const { steps = 1 } = options;
  const element = toolSurface('pen');
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: points[0].x,
    clientY: points[0].y,
  });
  settle();
  for (let index = 1; index < points.length; index += 1) {
    for (let step = 1; step <= steps; step += 1) {
      const previous = points[index - 1];
      const next = points[index];
      const t = step / steps;
      fireEvent.pointerMove(element, {
        pointerId: POINTER_ID,
        pointerType: 'mouse',
        buttons: 1,
        clientX: previous.x + (next.x - previous.x) * t,
        clientY: previous.y + (next.y - previous.y) * t,
      });
      settle();
    }
  }
  const last = points[points.length - 1];
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 0,
    clientX: last.x,
    clientY: last.y,
  });
  settle();
}

/**
 * A drag whose samples arrive the way a fast pointer delivers them: one `pointermove`
 * per frame, each carrying the points the browser merged away inside it. This is how a
 * test reaches five thousand points without dispatching five thousand events - and it
 * is the honest way, because a 120 Hz pointer really does arrive like this.
 */
export function coalescedDragOnPen(
  from: Point,
  to: Point,
  samplesPerEvent: number,
  events: number,
): void {
  const element = toolSurface('pen');
  const total = samplesPerEvent * events;
  const sample = (index: number): Point => ({
    x: from.x + ((to.x - from.x) * index) / total,
    y: from.y + ((to.y - from.y) * index) / total,
  });
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: from.x,
    clientY: from.y,
  });
  settle();
  for (let event = 0; event < events; event += 1) {
    const at = sample((event + 1) * samplesPerEvent);
    const move = new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: 1,
    });
    // The samples the browser merged into this one, the last of them the event's own
    // point - which is what a browser puts there, and what the tool counts. A coalesced
    // event is a pointer event, so it carries `clientX`/`clientY` like its parent.
    const first = event * samplesPerEvent + 1;
    Object.defineProperty(move, 'getCoalescedEvents', {
      configurable: true,
      writable: true,
      value: () =>
        Array.from({ length: samplesPerEvent }, (_unused, index) => {
          const at = sample(first + index);
          return { clientX: at.x, clientY: at.y };
        }),
    });
    fireEvent(element, move);
    settle();
  }
  const last = sample(total);
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 0,
    clientX: last.x,
    clientY: last.y,
  });
  settle();
}

export function strokeElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="stroke-object"]'));
}

/** The nth stroke as drawn (0 is the bottom-most). */
export function strokeElement(index = 0): HTMLElement {
  const elements = strokeElements();
  const element = elements[index];
  if (!element) throw new Error(`no stroke rendered at position ${index} of ${elements.length}`);
  return element;
}

/** Every stroke in the document, in drawing order. */
export function strokes(): readonly StrokeSnap[] {
  return docNotes().filter((object): object is StrokeSnap => object.type === 'stroke');
}

export function strokeData(index = 0): StrokeSnap {
  const list = strokes();
  const stroke = list[index];
  if (!stroke) throw new Error(`the board has no stroke at position ${index} of ${list.length}`);
  return stroke;
}

export function strokeId(index = 0): string {
  return strokeData(index).id;
}

/** The invisible line a click on a stroke answers to. */
export function strokeHitElement(index = 0): SVGElement {
  const elements = Array.from(document.querySelectorAll<SVGElement>('[data-testid="stroke-hit"]'));
  const element = elements[index];
  if (!element) throw new Error(`no stroke drawn at position ${index} to click`);
  return element;
}

/** The ink itself, which is what a click is measured against. */
export function strokeLineElement(index = 0): SVGElement {
  const elements = Array.from(document.querySelectorAll<SVGElement>('[data-testid="stroke-line"]'));
  const element = elements[index];
  if (!element) throw new Error(`no stroke drawn at position ${index} to look at`);
  return element;
}

/** The centre of a stroke's box, on the screen. */
export function strokeScreenCentre(index = 0): Point {
  const stroke = strokeData(index);
  return screenOf({
    x: stroke.x + (stroke.width ?? 0) / 2,
    y: stroke.y + (stroke.height ?? 0) / 2,
  });
}
