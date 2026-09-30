// Driving a board that has free text on it (story 9's component tests).
//
// Built on story 8's driver (`board-ui.tsx`) rather than beside it: the same fake
// provider, the same real `<Board>`, the same rule that nothing is asserted by calling
// the model. What is added here is the text tool and the object it makes — the tool
// keys, a click on empty board with the tool up, the editor's own test id, and the
// handles the selection draws.
//
// The measurer is not faked here. jsdom cannot make a canvas context, so the board's
// own measurer falls back to its fixed estimate — the same estimate on every machine,
// which is what makes the expectations below arithmetic rather than screenshots.
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
/** A live `Y.Map`, taken by structure so this file imports no Yjs classes as values. */
type LiveMap = {
  observe: (handler: (event: { keys: { has(key: string): boolean } }) => void) => void;
  unobserve: (handler: (event: { keys: { has(key: string): boolean } }) => void) => void;
  observeDeep: unknown;
};
import { readTextSnapshot } from '../../../src/shared/objects/text';
import { Board } from '../../../src/client/board/Board';
import { objectBounds, snapshotObjects } from '../../../src/shared/board-model';
import type { TextSnapshot } from '../../../src/shared/objects/text';
import { TEXT_SIZES } from '../../../src/shared/config';
import type { Rect } from '../../../src/shared/geometry';
import type { Camera, Point } from '../../../src/client/canvas/camera';
import { worldToScreen } from '../../../src/client/canvas/camera';
import { FakeWebsocketProvider } from './fake-provider';
import { dispatchPointer, VIEWPORT } from './events';
import { advance, doc, flush, screenOfPoint } from './board-ui';

export { advance, doc, FakeWebsocketProvider, flush, screenOfPoint, VIEWPORT };

/**
 * jsdom has no canvas: `getContext('2d')` logs "Not implemented" and answers null.
 * Story 9's measurer is written for exactly that — with no canvas it lays out from a
 * fixed estimate, which is the same on every machine — so the null answer is the
 * right one and only its log is noise. Quietly return null, once, for the whole file.
 */
type QuietCanvas = ((...args: never[]) => null) & { __vidi6NoCanvas?: boolean };
{
  const prototype = HTMLCanvasElement.prototype as unknown as {
    getContext?: QuietCanvas;
  };
  if (prototype.getContext && !prototype.getContext.__vidi6NoCanvas) {
    const quiet = (() => null) as QuietCanvas;
    quiet.__vidi6NoCanvas = true;
    prototype.getContext = quiet;
  }
}

/** World origin at the window centre until the camera is measured. */
const IDLE_CAMERA: Camera = { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 1 };

export const camera = (): Camera => window.__vidi6?.getCamera() ?? IDLE_CAMERA;

/** Open the board and let it sync, so it is editable. */
export function open(boardId: string): void {
  render(<Board boardId={boardId} />);
  act(() => {
    FakeWebsocketProvider.last().markSynced();
  });
  flush();
}

const viewport = (): HTMLElement => screen.getByTestId('board-viewport');

// --- the tool ----------------------------------------------------------------

/** A board-level keystroke, with the caret nowhere. */
export function pressKey(init: Record<string, unknown>): void {
  fireEvent.keyDown(document.body, init);
  flush();
}

export const pressTextTool = (): void => pressKey({ key: 't' });
export const pressSelectTool = (): void => pressKey({ key: 'v' });
export const pressEscape = (): void => pressKey({ key: 'Escape' });
export const pressNewNote = (): void => pressKey({ key: 'n' });

const pressed = (testId: string): boolean =>
  (screen.getByTestId(testId) as HTMLButtonElement).getAttribute('aria-pressed') === 'true';

export const textToolActive = (): boolean => pressed('tool-text');
export const selectToolActive = (): boolean => pressed('tool-select');

/** The rail's Text button, so a test can click it instead of using the key. */
export const textToolButton = (): HTMLButtonElement =>
  screen.getByTestId('tool-text') as HTMLButtonElement;

/** Press and release in one place without moving: a click on the board. */
export function clickEmpty(at: Point): void {
  const spot = screenOfPoint(at);
  dispatchPointer(viewport(), 'pointerdown', spot.x, spot.y);
  dispatchPointer(viewport(), 'pointerup', spot.x, spot.y);
  flush();
}

/**
 * The Text tool's whole job in one line: ask for the tool, click where the words
 * should start. Returns the object that came of it.
 */
export function placeText(at: Point): TextSnapshot {
  const before = textIds();
  pressTextTool();
  clickEmpty(at);
  const created = textIds().filter((id) => !before.includes(id));
  if (created.length !== 1) throw new Error(`expected one new text object, got ${created.length}`);
  return textObject(created[0]);
}

// --- the objects -------------------------------------------------------------

export function textObject(id: string): TextSnapshot {
  // The generic snapshot cannot carry a Y.Text (board-model), so the text object's
  // own reader is the one that answers size, width mode and characters.
  const object = readTextSnapshot(doc(), id);
  if (!object) throw new Error(`"${id}" is not a text object in the document`);
  return object;
}

/** The box as the board sees it, defaults and all. */
export const boxOf = (id: string): Rect => objectBounds(textObject(id));

/** Just the size of the box: the tests that are not about where it sits. */
export const boxSize = (id: string): { width: number; height: number } => {
  const box = boxOf(id);
  return { width: box.width, height: box.height };
};

export const textIds = (): string[] =>
  snapshotObjects(doc())
    .filter((object) => object.type === 'text')
    .map((object) => object.id);

/** The whole box, position included. */
export const textBox = (id: string): Rect => boxOf(id);

export const textElement = (id: string): HTMLElement => {
  const found = (screen.queryAllByTestId('text-object') as HTMLElement[]).find(
    (element) => element.dataset.id === id,
  );
  if (!found) throw new Error(`no text object "${id}" on the screen`);
  return found;
};

export const textElements = (): HTMLElement[] =>
  screen.queryAllByTestId('text-object') as HTMLElement[];

/** The open editor. There is only ever one: the board edits one object at a time. */
export const textEditor = (): HTMLTextAreaElement =>
  screen.getByTestId('text-object-editor') as HTMLTextAreaElement;

export const textIsBeingEdited = (): boolean =>
  screen.queryAllByTestId('text-object-editor').length > 0;

/** Type a whole value into the open editor, the way `input` reports it. */
export function typeText(value: string): void {
  fireEvent.input(textEditor(), { target: { value } });
  advance(16);
}

/** A keystroke inside the open editor. */
export function pressInEditor(key: string, init: Record<string, unknown> = {}): void {
  fireEvent.keyDown(textEditor(), { key, ...init });
  flush();
}

/** Escape inside the editor (as opposed to Escape on the board). */
export const escapeEditor = (): void => pressInEditor('Escape');

/** Escape in the editor, then the flush that lets the empty object be thrown away. */
export function endEditWithEscape(): void {
  escapeEditor();
  flush();
}

/** A keystroke on the board's own selection, e.g. Ctrl+Z with nothing focused. */
export const pressUndo = (): void => {
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
  flush();
};

// --- the selection -----------------------------------------------------------

/** Click an object once: it becomes the selection. */
export function selectObject(id: string): void {
  const element =
    textElementOrNull(id) ?? (screen.getByTestId('sticky-note') as HTMLElement);
  const box = element.getBoundingClientRect();
  const spot = { x: box.left + 1, y: box.top + 1 };
  dispatchPointer(element, 'pointerdown', spot.x, spot.y);
  dispatchPointer(element, 'pointerup', spot.x, spot.y);
  flush();
}

const textElementOrNull = (id: string): HTMLElement | null =>
  (screen.queryAllByTestId('text-object') as HTMLElement[]).find(
    (element) => element.dataset.id === id,
  ) ?? null;

/** Which resize handles the selection is drawing, in the order it draws them. */
export const handleNames = (): string[] =>
  (screen.queryAllByTestId('resize-handle') as HTMLElement[]).map(
    (element) => element.dataset.handle ?? '',
  );

/** A drawn handle by name, at its screen position. */
export function handleElement(name: string): HTMLElement {
  const found = (screen.queryAllByTestId('resize-handle') as HTMLElement[]).find(
    (element) => element.dataset.handle === name,
  );
  if (!found) throw new Error(`no "${name}" handle on the screen`);
  return found;
}

/** Drag a named handle from where it is to a world point. */
export function dragHandle(name: string, toWorld: Point): void {
  const element = handleElement(name);
  const rect = element.getBoundingClientRect();
  const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const to = worldToScreen(camera(), toWorld);
  dispatchPointer(element, 'pointerdown', from.x, from.y);
  dispatchPointer(window, 'pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2);
  advance(16);
  dispatchPointer(window, 'pointermove', to.x, to.y);
  advance(16);
  dispatchPointer(window, 'pointerup', to.x, to.y);
  flush();
}

/** The size a text object's toolbar says is on. */
export const textToolbarSize = (): string | null => {
  for (const size of Object.keys(TEXT_SIZES)) {
    const button = screen.queryByTestId(`text-size-${size}`) as HTMLButtonElement | null;
    if (button && button.getAttribute('aria-pressed') === 'true') return size;
  }
  return null;
};

export function clickTextToolbar(testId: string): void {
  fireEvent.click(screen.getByTestId(testId) as HTMLButtonElement);
  flush();
}

/** One object's own `Y.Map`, for the rare test that writes the document by hand. */
export const objectMap = (id: string): { get: (key: string) => unknown; set: (key: string, value: unknown) => void } => {
  const map = doc().getMap('objects').get(id);
  if (!map) throw new Error(`"${id}" is not in the document`);
  return map as unknown as { get: (key: string) => unknown; set: (key: string, value: unknown) => void };
};

/** Count writes to one object's box, however they were caused. */
export function countBoxWrites(id: string, run: () => void): number {
  const object = objectMap(id) as unknown as LiveMap;
  let writes = 0;
  const observe = (event: { keys: { has(key: string): boolean } }): void => {
    if (event.keys.has('width') || event.keys.has('height')) writes += 1;
  };
  object.observeDeep; // (the box is a key of this map, so a flat observer is enough)
  object.observe(observe);
  run();
  object.unobserve(observe);
  return writes;
}

/**
 * A change made by somebody else, which a test cannot fake with an origin: a
 * transaction written here is local whatever origin it is handed. So there is a
 * second document, put in step with ours the way a provider puts two clients in step,
 * the change is made there, and the update is applied over here — where it arrives
 * exactly as a remote one does (`transaction.local === false`).
 */
export function remoteChange(change: (other: Y.Doc) => void): void {
  const other = new Y.Doc();
  act(() => {
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc()));
    change(other);
    Y.applyUpdate(doc(), Y.encodeStateAsUpdate(other));
  });
  flush();
}

/** The `objects` map of any document, for writing one by hand. */
export const objectsOf = (document: Y.Doc): Y.Map<Y.Map<unknown>> =>
  document.getMap<Y.Map<unknown>>('objects');

/** One object's own map in any document. */
export const mapIn = (document: Y.Doc, id: string): Y.Map<unknown> => {
  const map = objectsOf(document).get(id);
  if (!map) throw new Error(`"${id}" is not in that document`);
  return map;
};

/** One object's shared text in any document. */
export const ytextIn = (document: Y.Doc, id: string): Y.Text => {
  const text = mapIn(document, id).get('text');
  if (!(text instanceof Y.Text)) throw new Error(`"${id}" carries no text`);
  return text;
};
