import { act, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import type { Camera } from '../../src/client/canvas/camera';
import { Board } from '../../src/client/board/Board';
import {
  createSticky,
  getStickyText,
  LOCAL_ORIGIN,
  objectBounds,
  objectSnapshots,
  snapshot,
  type ObjectSnapshot,
  type StickySnapshot,
  type TextSnapshot,
} from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import type { Point } from '../../src/shared/geometry';
import { createStroke } from '../../src/shared/objects/stroke';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import type { PenColor, PenThickness, TextSize } from '../../src/shared/config';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../src/shared/config';
import { createText, setTextSize, setTextWidthFixed } from '../../src/shared/objects/text';

// Story 5 moved the board out of the app shell: these tests mount the board itself
// (the stories 1-4 surface), which is what the board page shows once a link has been
// answered. The address bar is the router's business and has its own tests.

/** The link the component tests pretend the address bar holds. */
export const TEST_BOARD_ID = 'componenttestboard0004';

/**
 * Render the board at that link, with the address bar holding the link — which is
 * how the board page mounts it, and what the connection is named after.
 */
export function renderBoard(): ReturnType<typeof render> {
  window.history.replaceState(null, '', `/b/${TEST_BOARD_ID}`);
  return render(<Board boardId={TEST_BOARD_ID} />);
}

/** The live board document, exposed by <Board/> in test mode. */
export function boardDoc(): Y.Doc {
  const d = (window as unknown as { __vidi6Board?: Y.Doc }).__vidi6Board;
  if (!d) throw new Error('board doc test hook missing (renderBoard() first)');
  return d;
}

export function surface(): HTMLElement {
  return screen.getByTestId('board-viewport');
}
export function world(): HTMLElement {
  return screen.getByTestId('world-layer');
}
export function noteCount(): number {
  return screen.queryAllByRole('group', { name: 'Sticky note' }).length;
}
export function noteEl(id: string): HTMLElement {
  return screen.getByTestId(`sticky-note-${id}`);
}
export function textEl(id: string): HTMLElement {
  return within(noteEl(id)).getByTestId('sticky-note-text');
}

export function readCamera(): Camera {
  const d = world().dataset;
  return { x: Number(d.x), y: Number(d.y), zoom: Number(d.zoom) };
}

/** Create a note straight through the model so the snapshot renders it. */
export function createNote(x: number, y: number): string {
  let id = '';
  act(() => {
    id = createSticky(boardDoc(), { x, y });
  });
  return id;
}

/** Seed a note's text through the model. */
export function seedText(id: string, text: string): void {
  act(() => {
    getStickyText(boardDoc(), id)?.insert(0, text);
  });
}

export function pointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): void {
  fireEvent(
    el,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );
}

export function doubleClick(el: Element, x = 0, y = 0): void {
  fireEvent(
    el,
    new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );
}

/** Press a note and release without moving: selects it. */
export function clickNote(id: string): void {
  const el = noteEl(id);
  pointer(el, 'pointerdown', 0, 0);
  pointer(el, 'pointerup', 0, 0);
}

/** Shift-press a note and release: adds or removes it from the selection. */
export function shiftClickNote(id: string): void {
  const el = noteEl(id);
  shiftPointer(el, 'pointerdown', 0, 0);
  pointer(el, 'pointerup', 0, 0);
}

export function windowKey(
  key: string,
  modifiers: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {},
): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ctrlKey: modifiers.ctrlKey ?? false,
        metaKey: modifiers.metaKey ?? false,
        shiftKey: modifiers.shiftKey ?? false,
      }),
    );
  });
}

/** Dispatch a keydown on a specific element (bubbles to window). */
export function keyOn(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

/** Set a textarea's value and fire `input` (our editor listens to onInput). */
export function inputInto(el: HTMLElement, value: string): void {
  const ta = el as HTMLTextAreaElement;
  fireEvent.input(ta, { target: { value } });
}

/** Click a swatch / toolbar button by accessible name. */
export function clickByRole(name: string): void {
  const btn = screen.getByRole('button', { name });
  fireEvent(
    btn,
    new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  fireEvent.click(btn);
}

export function noteSelected(id: string): boolean {
  return noteEl(id).getAttribute('data-selected') === 'true';
}

// --- story 7 helpers -------------------------------------------------------

/**
 * Fire a pointer event carrying `shiftKey`. The marquee and shift-click select
 * gestures branch on this flag, which the plain `pointer` helper never sets.
 */
export function shiftPointer(
  el: Element | Window,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): void {
  fireEvent(
    el as Element,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      shiftKey: true,
    }),
  );
}

/**
 * Shift-drag a marquee from one screen point to another: a Shift pointer-down on
 * the board surface, a move and a release on the window (where the marquee hook
 * listens). Releases unless `end` is given as 'cancel'.
 */
export function marqueeDrag(
  from: [number, number],
  to: [number, number],
  end: 'up' | 'cancel' | 'none' = 'up',
): void {
  shiftPointer(surface(), 'pointerdown', from[0], from[1]);
  shiftPointer(window, 'pointermove', to[0], to[1]);
  if (end === 'up') shiftPointer(window, 'pointerup', to[0], to[1]);
  else if (end === 'cancel') shiftPointer(window, 'pointercancel', to[0], to[1]);
}

// --- story 10 helpers -------------------------------------------------------

/** Which creating tool's layer to press on. */
export type ToolLayerName = 'shape-tool-layer' | 'connector-tool-layer' | 'pen-tool-layer';

/**
 * The transparent layer a creating tool holds while it is the tool this tab has.
 *
 * A test presses *this* element rather than the board surface underneath it, because that
 * is what a person's pointer is on while the tool is held: the tool layer is a sibling of
 * the surface, so an event sent at the surface would never reach the tool and a test that
 * pressed the surface would be testing the Select tool.
 */
export function toolLayer(name: ToolLayerName): HTMLElement {
  return screen.getByTestId(name);
}

export interface ToolDragOptions {
  /** Shift held for the whole gesture (a shape's square, a marquee's additive). */
  shift?: boolean;
  /** How the gesture finishes: released, cancelled, or left hanging in the air. */
  end?: 'up' | 'cancel' | 'none';
  /** How many moves between the press and the release (default: 3). */
  steps?: number;
}

/**
 * Press, move and release over a tool layer, in screen points. The press lands on the
 * layer and the moves and the release on the window, which is where `useWindowPointer`
 * listens — the same split a real pointer makes, since the pointer keeps sending events to
 * the element that took the press only while it is captured.
 *
 * Every dispatch is wrapped in `act`, so by the time this returns the board has rendered
 * whatever the gesture wrote and a test can read the document and the DOM alike.
 */
export function toolDrag(
  layer: HTMLElement,
  from: [number, number],
  to: [number, number],
  options: ToolDragOptions = {},
): void {
  const { shift = false, end = 'up', steps = 3 } = options;
  const send = (
    el: Element | Window,
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    x: number,
    y: number,
  ) => {
    act(() => {
      fireEvent(
        el as Element,
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          shiftKey: shift,
        }),
      );
    });
  };
  send(layer, 'pointerdown', from[0], from[1]);
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    send(window, 'pointermove', from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
  }
  if (end === 'up') send(window, 'pointerup', to[0], to[1]);
  else if (end === 'cancel') send(window, 'pointercancel', to[0], to[1]);
}

/**
 * A single click on a tool layer: press and release without the pointer ever moving.
 * Every creating tool turns that into something of its default size, which is the point —
 * a hand cannot drag a box to an exact pixel.
 */
export function toolClick(layer: HTMLElement, at: [number, number]): void {
  toolDrag(layer, at, at, { steps: 0 });
}

/** The current world bounds of a note, read straight from the live document. */
export function noteBounds(id: string): Rect {
  const obj = snapshot(boardDoc()).find((n) => n.id === id);
  if (!obj) throw new Error(`note ${id} not in document`);
  return objectBounds(obj);
}

/** The live document snapshot (for "did anything get written?" checks). */
export function modelSnapshot(): readonly StickySnapshot[] {
  return snapshot(boardDoc());
}

/** Any object snapshot (unknown types included) for generic-machinery tests. */
export function rawObjects(): readonly ObjectSnapshot[] {
  return objectSnapshots(boardDoc());
}

/** The selection bar element, or null when it is not shown. */
export function selectionBarEl(): HTMLElement | null {
  return screen.queryByTestId('selection-bar');
}

/** The count text the bar announces, e.g. "3 selected". */
export function selectionCountText(): string | null {
  const bar = selectionBarEl();
  if (!bar) return null;
  return within(bar).getByText(/^\d+ selected$/).textContent;
}

/** Ids currently marked selected in the DOM, sorted for stable comparison. */
export function selectedIds(): string[] {
  return selectedObjectIds();
}

/**
 * Every selected object id, whatever its type: sticky notes and free text objects
 * both carry `data-selected` and their id on the rendered element.
 */
export function selectedObjectIds(): string[] {
  const ids: string[] = [];
  for (const el of screen.queryAllByTestId(/^sticky-note-./)) {
    if (el.getAttribute('data-selected') === 'true') ids.push(el.getAttribute('data-note-id')!);
  }
  for (const el of screen.queryAllByTestId(/^text-object-./)) {
    if (el.getAttribute('data-selected') === 'true') {
      ids.push(el.getAttribute('data-text-object-id')!);
    }
  }
  // Story 10's two types carry their id the same way. Only the rendered object itself has
  // `data-object-id` — its figure, its label and its arrowhead are decoration. Story 11's
  // drawings too: an svg, a hit line and an ink line carry no `data-object-id` of their own.
  for (const el of screen.queryAllByTestId(/^(shape|connector|stroke)-./)) {
    const id = el.getAttribute('data-object-id');
    if (id !== null && el.getAttribute('data-selected') === 'true') ids.push(id);
  }
  return ids.sort();
}

// --- story 11 helpers ------------------------------------------------------

/** The drawings on the board, as this client's model sees them. */
export function strokes(): StrokeSnap[] {
  return objectSnapshots(boardDoc()).filter((o): o is StrokeSnap => o.type === 'stroke');
}

/** One drawing, or a failure that names the id a test is looking for. */
export function strokeOf(id: string): StrokeSnap {
  const found = strokes().find((s) => s.id === id);
  if (!found) throw new Error(`stroke ${id} is not on the board`);
  return found;
}

/**
 * The rendered box of a stroke. Like an arrow's, it is not a hit target: a squiggle's bounding
 * box is a rectangle nobody drew (pen.select), so pressing this element is pressing nothing and
 * selects nothing — which is a thing worth being able to assert.
 */
export function strokeEl(id: string): HTMLElement {
  return screen.getByTestId(`stroke-${id}`);
}

/** The line a press on a stroke has to land on, at the width a hand can hit. */
export function strokeLineEl(id: string): SVGElement {
  const el = screen.getByTestId(`stroke-hit-${id}`);
  if (!(el instanceof SVGElement)) throw new Error(`${id} is not drawn as a line`);
  return el;
}

/** The ink of a stroke: what a person sees, and what a resize must scale. */
export function strokeInkEl(id: string): SVGElement {
  const el = screen.getByTestId(`stroke-line-${id}`);
  if (!(el instanceof SVGElement)) throw new Error(`${id} has no ink`);
  return el;
}

/** Select a stroke the way a person does: press its line. */
export function clickStroke(id: string): void {
  const el = strokeLineEl(id);
  act(() => {
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointerup', 0, 0);
  });
}

/** Shift-press a stroke's line: add it to the selection, or take it out of the selection. */
export function shiftClickStroke(id: string): void {
  const el = strokeLineEl(id);
  act(() => {
    shiftPointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointerup', 0, 0);
  });
}

/**
 * Draw a stroke through the model, at world points: the same `createStroke` the Pen tool calls,
 * so what comes back is indistinguishable from a stroke that was drawn. Used by the tests that
 * need a stroke to exist and are not about drawing one.
 */
export function seedStroke(
  points: readonly Point[],
  color: PenColor = DEFAULT_PEN_COLOR,
  thickness: PenThickness = DEFAULT_PEN_THICKNESS,
): string {
  let id: string | null = null;
  act(() => {
    id = createStroke(boardDoc(), { points, color, thickness }, 'local-tab');
  });
  if (id === null) throw new Error('the model refused to draw it');
  return id;
}

/** The pen this tab is holding, as the tool holds it: ink and nib. */
export function penOptions(): { color: PenColor; thickness: PenThickness } {
  const color = screen.getByTestId('pen-toolbar').querySelector('[aria-pressed="true"]');
  const ink = color?.getAttribute('data-pen-color');
  const nib = screen
    .getByTestId('pen-toolbar')
    .querySelector('[data-pen-thickness][aria-pressed="true"]')
    ?.getAttribute('data-pen-thickness');
  if (ink === null || ink === undefined || nib === null || nib === undefined) {
    throw new Error('the pen toolbar is not showing a chosen ink and nib');
  }
  return { color: ink as PenColor, thickness: nib as PenThickness };
}

// --- story 9 helpers -------------------------------------------------------

/**
 * A second, fully independent client of the same board: its own `Y.Doc`, synchronised
 * with the rendered board in both directions the way the sync server synchronises two
 * browsers. Anything this peer writes arrives in the board document with a *foreign*
 * transaction origin, which is exactly what "remote" means to the client — the only
 * honest way to test "the local client wrote it, not the other one".
 */
export function peerTab(): Y.Doc {
  const board = boardDoc();
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(board));
  peer.on('update', (update) => Y.applyUpdate(board, update));
  board.on('update', (update) => Y.applyUpdate(peer, update));
  return peer;
}

/** Create a text object straight through the model. */
export function createTextObject(x: number, y: number, by = 'local-tab'): string {
  let id = '';
  act(() => {
    const made = createText(boardDoc(), { x, y }, by);
    if (!made) throw new Error('createText returned null');
    id = made;
  });
  return id;
}

/** The rendered element of a text object. */
export function textObjectEl(id: string): HTMLElement {
  return screen.getByTestId(`text-object-${id}`);
}

/** The rendered text of a text object (not while it is being edited). */
export function textContentEl(id: string): HTMLElement {
  return screen.getByTestId(`text-content-${id}`);
}

/**
 * The open text editor, whichever kind of object is being edited: free text or a
 * sticky note. Both are the same component (`TextEditor`); only the test id each one
 * is given differs, and story 2's tests address the sticky one by name.
 */
export function editorEl(): HTMLElement {
  return screen.queryByTestId('text-editor') ?? screen.getByTestId('sticky-note-text');
}

/** The live document snapshot of every object, text included. */
export function objectSnapshot(id: string): ObjectSnapshot | undefined {
  return objectSnapshots(boardDoc()).find((o) => o.id === id);
}

/** The stored text box of an object (the width / height every client reads). */
export function objectBox(id: string): { width: number; height: number } {
  const obj = objectSnapshot(id);
  if (!obj) throw new Error(`object ${id} not in document`);
  if (obj.width === undefined || obj.height === undefined) {
    throw new Error(`object ${id} has no stored box`);
  }
  return { width: obj.width, height: obj.height };
}

/** The stored fields of a text object. */
export function textFields(id: string): TextSnapshot {
  const obj = objectSnapshot(id);
  if (!obj || obj.type !== 'text') throw new Error(`no text object ${id}`);
  return obj as TextSnapshot;
}

/** Every text object id currently in the document, in creation order of the map. */
export function textObjectIds(): string[] {
  return objectSnapshots(boardDoc())
    .filter((o) => o.type === 'text')
    .map((o) => o.id);
}

/**
 * Run `fn` and return how many times *this* client wrote the object's stored box
 * (a `setTextBox` write is a local-origin change of `width` / `height`). Counting the
 * Yjs key changes rather than the function calls is what makes "no redundant write"
 * and "a remote change writes nothing" testable statements.
 */
export function boxWritesOf(
  id: string,
  fn: () => void,
  keys: readonly string[] = ['width', 'height'],
): number {
  const map = boardDoc().getMap<Y.Map<unknown>>('objects').get(id);
  if (!map) throw new Error(`object ${id} not in document`);
  let writes = 0;
  const observer = (event: Y.YMapEvent<unknown>, tr: Y.Transaction): void => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    if (keys.some((key) => event.keysChanged.has(key))) writes += 1;
  };
  map.observe(observer);
  try {
    act(fn);
  } finally {
    map.unobserve(observer);
  }
  return writes;
}

/** Select an object by pressing it (a press-and-release without moving). */
/**
 * Press and release on empty board at a screen point: a plain board click. What it
 * does depends on the tool — Select deselects (and can pan / marquee), Text writes a
 * text object there — which is exactly what the story 9 tool tests are about.
 */
export function clickBoard(x: number, y: number): void {
  const el = surface();
  act(() => {
    pointer(el, 'pointerdown', x, y);
    pointer(el, 'pointerup', x, y);
  });
}

/**
 * Press and release an object where it is drawn: selects it, whatever its type. Text
 * objects and sticky notes are addressed by their own test ids.
 */
/** The rendered element of any object, by its document id. */
export function objectEl(id: string): HTMLElement {
  return (
    screen.queryByTestId(`text-object-${id}`) ??
    screen.queryByTestId(`shape-${id}`) ??
    screen.queryByTestId(`connector-${id}`) ??
    screen.queryByTestId(`stroke-${id}`) ??
    screen.getByTestId(`sticky-note-${id}`)
  );
}

export function clickObject(id: string): void {
  const el = objectEl(id);
  act(() => {
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointerup', 0, 0);
  });
}

/**
 * The element of an arrow that a pointer can actually land on.
 *
 * An arrow's box is empty board (connector.select): the object's own element takes no
 * presses by design, and the line drawn under the arrow is what a person hits. Pressing the
 * box would be pressing nothing, which is why it selects nothing.
 */
export function connectorLineEl(id: string): SVGElement {
  const el = screen.getByTestId(`connector-hit-${id}`);
  if (!(el instanceof SVGElement)) throw new Error(`${id} is not drawn as a line`);
  return el;
}

/** Select an arrow the way a person does: press its line. */
export function clickConnector(id: string): void {
  const el = connectorLineEl(id);
  act(() => {
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointerup', 0, 0);
  });
}

/** The handle of one end of a selected arrow. */
export function connectorHandleEl(id: string, end: 'from' | 'to'): SVGElement {
  const el = screen.getByTestId(`connector-handle-${end}-${id}`);
  if (!(el instanceof SVGElement)) throw new Error(`${id}'s ${end} end is not a handle`);
  return el;
}

/** Open the editor of a text object the way a person does: double-click it. */
/** Press and double-click an object: opens its editor (any object type). */
export function editTextObject(id: string): void {
  clickObject(id);
  doubleClick(objectEl(id));
}

/** Type into the open editor as a whole (one input event, like a paste). */
export function typeIntoEditor(value: string): void {
  inputInto(editorEl(), value);
}

/** Change a text object's size preset the way the size toolbar does. */
export function textSizePreset(id: string, size: TextSize): void {
  act(() => {
    setTextSize(boardDoc(), id, size);
  });
}

/** Change a text object's fixed width the way a side-handle drag does. */
export function textFixedWidth(id: string, width: number): void {
  act(() => {
    setTextWidthFixed(boardDoc(), id, width);
  });
}
