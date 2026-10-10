import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardView } from '../../src/client/board/BoardView';
import type { UndoController } from '../../src/client/board/undo';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  objectSnapshots,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { createText, type TextSnapshot } from '../../src/shared/objects/text';
import { createShape, type ShapeSnapshot } from '../../src/shared/objects/shape';
import {
  createStroke,
  worldPoints,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import {
  createConnector,
  type ConnectorSnapshot,
  type EndpointInput,
} from '../../src/shared/objects/connector';
import type { BoardProvider } from '../../src/client/sync/connectBoard';
import type { Camera } from '../../src/client/canvas/camera';
import type { ShapeKind, PenColor, PenThickness, StickyColor } from '../../src/shared/config';

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
    /**
     * The undo history the board uses (story 8). Given, it is the board's own
     * history, so a test reads the very stacks the toolbar and the keys act on;
     * left out, the board makes one for itself.
     */
    undo?: UndoController;
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
      undo={options.undo}
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

/* ------------------------------------------------------------------------- */
/* Text object helpers (story 9)                                             */
/* ------------------------------------------------------------------------- */

/** Which tool the rendered board says this client is holding (`text.tool_ui`). */
export function activeTool(): string {
  return screen.getByTestId('app').getAttribute('data-tool') ?? '';
}

/** The id the board says is being edited, or `null`. */
export function editingId(): string | null {
  const value = screen.getByTestId('app').getAttribute('data-editing-id');
  return value === null || value === '' ? null : value;
}

const TOOL_BUTTON_TEST_IDS = {
  select: 'select-tool',
  text: 'text-tool',
  shape: 'shape-tool',
  connector: 'connector-tool',
  pen: 'pen-tool',
} as const;

/** Every tool the toolbar has a button for (`tool.shortcuts`). */
export type ToolbarTool = keyof typeof TOOL_BUTTON_TEST_IDS;

export function toolButton(tool: ToolbarTool): HTMLButtonElement {
  return screen.getByTestId(TOOL_BUTTON_TEST_IDS[tool]) as HTMLButtonElement;
}

export function toolPressed(tool: ToolbarTool): boolean {
  return toolButton(tool).getAttribute('aria-pressed') === 'true';
}

/** Create a text object through the model, and let the board re-render. */
export function createTextObject(
  doc: Y.Doc,
  at: { x: number; y: number },
  createdBy = 'component_client',
): string {
  let id = '';
  act(() => {
    id = createText(doc, at, createdBy) ?? '';
  });
  return id;
}

/** The text objects exactly as the document holds them (sorted by z, then id). */
export function docTexts(doc: Y.Doc): readonly TextSnapshot[] {
  return objectSnapshots(doc).filter((entry): entry is TextSnapshot => entry.type === 'text');
}

export function textOf(doc: Y.Doc, id: string): TextSnapshot {
  const entry = docTexts(doc).find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`text object ${id} is not in the document`);
  }
  return entry;
}

export function textElement(id: string): HTMLElement {
  return screen.getByTestId(`text-object-${id}`);
}

export function textElements(): HTMLElement[] {
  return screen.queryAllByTestId(/^text-object-/u);
}

export function textEditorElement(): HTMLElement | null {
  return screen.queryByTestId('text-editor');
}

export function textToolbarElement(): HTMLElement | null {
  return screen.queryByTestId('text-toolbar');
}

/** Type into the open text editor, one input event per call. */
export function typeIntoTextEditor(text: string): void {
  const editor = textEditorElement();
  if (!editor) {
    throw new Error('no text object is being edited');
  }
  const textarea = editor as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: `${textarea.value}${text}` } });
}

/** Replace the text editor's value outright (a paste). */
export function pasteIntoTextEditor(text: string): void {
  const editor = textEditorElement();
  if (!editor) {
    throw new Error('no text object is being edited');
  }
  fireEvent.change(editor as HTMLTextAreaElement, { target: { value: text } });
}

/* ------------------------------------------------------------------------- */
/* Shape helpers (story 10)                                                  */
/* ------------------------------------------------------------------------- */

export interface CreateShapeOptions {
  kind?: ShapeKind;
  /** Where the click lands, or the corner of the box when `rect` is given. */
  at: { x: number; y: number };
  /** The box a drag made; left out, the default click size is used. */
  rect?: { x: number; y: number; width: number; height: number } | null;
  square?: boolean;
  createdBy?: string;
}

/** Create a shape through the model, and let the board re-render. */
export function createShapeObject(doc: Y.Doc, options: CreateShapeOptions): string {
  let id = '';
  act(() => {
    id =
      createShape(
        doc,
        {
          kind: options.kind ?? 'rect',
          rect: options.rect ?? null,
          at: options.at,
          square: options.square ?? false,
        },
        options.createdBy ?? 'component_client',
      ) ?? '';
  });
  return id;
}

/** The shapes exactly as the document holds them (sorted by z, then id). */
export function docShapes(doc: Y.Doc): readonly ShapeSnapshot[] {
  return objectSnapshots(doc).filter((entry): entry is ShapeSnapshot => entry.type === 'shape');
}

export function shapeOf(doc: Y.Doc, id: string): ShapeSnapshot {
  const entry = docShapes(doc).find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`shape ${id} is not in the document`);
  }
  return entry;
}

export function shapeElements(): HTMLElement[] {
  return screen.queryAllByTestId(/^shape-object-/u);
}

export function shapeElement(id: string): HTMLElement {
  return screen.getByTestId(`shape-object-${id}`);
}

/** The SVG that draws it: the element a press, a drag or a double-click lands on. */
export function shapeSvgElement(id: string): HTMLElement {
  return screen.getByTestId(`shape-${id}`);
}

export function shapeLabelElement(id: string): HTMLElement | null {
  return screen.queryByTestId(`shape-label-${id}`);
}

export function shapeEditorElement(id: string): HTMLElement | null {
  return screen.queryByTestId(`shape-editor-${id}`);
}

export function shapeToolbarElement(): HTMLElement | null {
  return screen.queryByTestId('shape-toolbar');
}

export function shapeSwatch(label: string): HTMLButtonElement {
  return screen.getByRole('button', { name: label }) as HTMLButtonElement;
}

/** Type into the open shape label editor, one input event per call. */
export function typeIntoShapeEditor(id: string, text: string): void {
  const editor = shapeEditorElement(id);
  if (!editor) {
    throw new Error(`shape ${id} is not being edited`);
  }
  const textarea = editor as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: `${textarea.value}${text}` } });
}

/* ------------------------------------------------------------------------- */
/* Connector helpers (story 10)                                              */
/* ------------------------------------------------------------------------- */

/** Create a connector through the model, and let the board re-render. */
export function createConnectorObject(
  doc: Y.Doc,
  from: EndpointInput,
  to: EndpointInput,
  createdBy = 'component_client',
): string {
  let id = '';
  act(() => {
    id = createConnector(doc, from, to, createdBy) ?? '';
  });
  return id;
}

/** The connectors exactly as the document holds them (sorted by z, then id). */
export function docConnectors(doc: Y.Doc): readonly ConnectorSnapshot[] {
  return objectSnapshots(doc).filter(
    (entry): entry is ConnectorSnapshot => entry.type === 'connector',
  );
}

export function connectorOf(doc: Y.Doc, id: string): ConnectorSnapshot {
  const entry = docConnectors(doc).find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`connector ${id} is not in the document`);
  }
  return entry;
}

export function connectorElements(): HTMLElement[] {
  return screen.queryAllByTestId(/^connector-object-/u);
}

export function connectorElement(id: string): HTMLElement {
  return screen.getByTestId(`connector-object-${id}`);
}

/** The handle at one end of the selected arrow a person drags (`connector.reattach`). */
export function connectorHandleElement(end: 'from' | 'to'): HTMLElement {
  return screen.getByTestId(`connector-handle-${end}`);
}

export function connectorDots(): HTMLElement[] {
  return screen.queryAllByTestId('connector-dot');
}

/** The dot the arrow would attach to, or `null` when none is highlighted. */
export function activeConnectorDot(): HTMLElement | null {
  return connectorDots().find((dot) => dot.getAttribute('data-active') === 'true') ?? null;
}

export function connectorPreviewLine(): HTMLElement | null {
  return screen.queryByTestId('connector-preview-line');
}

/** The centre of a shape, in screen coordinates: where to press it. */
export function shapeCentre(id: string, doc: Y.Doc): { x: number; y: number } {
  return screenCentre(shapeOf(doc, id));
}

/** The four side midpoints of a shape, in screen coordinates (`connector.attach`). */
export function shapeSideMidpoints(doc: Y.Doc, id: string): Record<'top' | 'right' | 'bottom' | 'left', { x: number; y: number }> {
  const shape = shapeOf(doc, id);
  const at = (x: number, y: number) => screenOf({ x, y });
  return {
    top: at(shape.x + shape.width / 2, shape.y),
    right: at(shape.x + shape.width, shape.y + shape.height / 2),
    bottom: at(shape.x + shape.width / 2, shape.y + shape.height),
    left: at(shape.x, shape.y + shape.height / 2),
  };
}

/** A point `px` screen pixels away from the arrow's line, perpendicular to it. */
export function offsetFromConnector(
  connector: ConnectorSnapshot,
  px: number,
  end: 'from' | 'to' = 'from',
): { x: number; y: number } {
  const a = connector.points.from;
  const b = connector.points.to;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  // The unit normal, in world units: the arrow is drawn at the current zoom, so a
  // screen offset becomes `px / zoom` of board units (`connector.select`).
  const world = px / readCamera().zoom;
  const nx = (-dy / length) * world;
  const ny = (dx / length) * world;
  const middle = end === 'from' ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : b;
  return screenOf({ x: middle.x + nx, y: middle.y + ny });
}

/* ------------------------------------------------------------------------- */
/* Pen and stroke helpers (story 11)                                         */
/* ------------------------------------------------------------------------- */

export interface CreateStrokeOptions {
  /** World-space points, in the order they were recorded. */
  points: { x: number; y: number }[];
  color?: PenColor;
  thickness?: PenThickness;
  createdBy?: string;
}

/** Create a stroke through the model, and let the board re-render. */
export function createStrokeObject(doc: Y.Doc, options: CreateStrokeOptions): string {
  let id = '';
  act(() => {
    id =
      createStroke(
        doc,
        {
          points: options.points,
          color: options.color ?? 'black',
          thickness: options.thickness ?? 'medium',
        },
        options.createdBy ?? 'component_client',
      ) ?? '';
  });
  return id;
}

/** The strokes exactly as the document holds them (sorted by z, then id). */
export function docStrokes(doc: Y.Doc): readonly StrokeSnap[] {
  return objectSnapshots(doc).filter((entry): entry is StrokeSnap => entry.type === 'stroke');
}

export function strokeOf(doc: Y.Doc, id: string): StrokeSnap {
  const entry = docStrokes(doc).find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`stroke ${id} is not in the document`);
  }
  return entry;
}

/** A stroke's recorded line, as the board sees it: world points, oldest first. */
export function strokeWorldPoints(stroke: StrokeSnap): { x: number; y: number }[] {
  return worldPoints(stroke);
}

export function strokeElements(): HTMLElement[] {
  return screen.queryAllByTestId(/^stroke-object-/u);
}

export function strokeElement(id: string): HTMLElement {
  return screen.getByTestId(`stroke-object-${id}`);
}

/** The visible line of a rendered stroke. */
export function strokeLineElement(id: string): HTMLElement {
  return screen.getByTestId(`stroke-line-${id}`);
}

/** The invisible band a click on a stroke's line lands on. */
export function strokeHitElement(id: string): HTMLElement {
  return screen.getByTestId(`stroke-hit-${id}`);
}

export function strokeSelected(id: string): boolean {
  return strokeElement(id).getAttribute('data-selected') === 'true';
}

export function penToolbarElement(): HTMLElement | null {
  return screen.queryByTestId('pen-toolbar');
}

export function penColorButton(color: PenColor): HTMLButtonElement {
  return screen.getByTestId(`pen-color-${color}`) as HTMLButtonElement;
}

export function penThicknessButton(thickness: PenThickness): HTMLButtonElement {
  return screen.getByTestId(`pen-thickness-${thickness}`) as HTMLButtonElement;
}

export function penColorPressed(color: PenColor): boolean {
  return penColorButton(color).getAttribute('aria-pressed') === 'true';
}

export function penThicknessPressed(thickness: PenThickness): boolean {
  return penThicknessButton(thickness).getAttribute('aria-pressed') === 'true';
}

/** The stroke being drawn, which only the person drawing can see. */
export function penPreviewElement(): HTMLElement | null {
  return screen.queryByTestId('pen-preview-path');
}

export function penPreviewPathData(): string | null {
  return penPreviewElement()?.getAttribute('d') ?? null;
}

export function penCursorElement(): HTMLElement | null {
  return screen.queryByTestId('pen-cursor');
}

export function pressPenTool(): void {
  fireEvent.click(toolButton('pen'));
}

/**
 * Draw with the pen through a list of **screen** points: press, one pointermove per
 * point, release. Every one of them is dispatched the way `pointerEvent` dispatches
 * a board press, because the Pen tool listens on `window`, in front of the board.
 */
export function penDragThrough(
  points: readonly { x: number; y: number }[],
  options: { cancel?: boolean; up?: boolean } = {},
): void {
  const first = points[0];
  if (!first) {
    return;
  }
  pointerEvent('pointerdown', first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    pointerEvent('pointermove', point.x, point.y);
  }
  const last = points[points.length - 1]!;
  if (options.cancel) {
    pointerEvent('pointercancel', last.x, last.y);
  } else if (options.up !== false) {
    pointerEvent('pointerup', last.x, last.y);
  }
}

/** A straight pen drag from one screen point to another. */
export function penDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
): void {
  const points: { x: number; y: number }[] = [];
  for (let step = 0; step <= steps; step += 1) {
    points.push({
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
  }
  penDragThrough(points);
}

/** Press and release without moving: the pen's dot (`pen.dot`). */
export function penClick(at: { x: number; y: number }): void {
  penDragThrough([at, at]);
}
