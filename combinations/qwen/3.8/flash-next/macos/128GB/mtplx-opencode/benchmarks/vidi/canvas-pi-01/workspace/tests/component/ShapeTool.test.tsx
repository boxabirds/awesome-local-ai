/**
 * Story 10 · task 14 — Shape tool / shape object / toolbar component tests
 * (TC-15 to TC-17, TC-28). The tool-state half of the story (TC-22) lives in
 * `useActiveTool.test.tsx`.
 *
 * These drive the real `BoardShell` in jsdom with a real `Y.Doc`: the Shape tool
 * overlay is the layer that owns every pointer gesture while it is active, so a
 * drag is checked end to end (preview → one `createShape` → select + return to
 * Select), a label is typed through the shared text editor, and the two swatch
 * rows recolour a selected shape without disturbing the label or the selection.
 *
 * jsdom has no layout: the tool's screen→world maths runs on the *default*
 * camera (`{-400,-300}` at zoom 1), so a screen drag maps to world units one for
 * one and the assertions name the exact stored rectangle.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';

const VIEWPORT = { width: 800, height: 600 };

beforeEach(() => {
  cleanup();
});

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function renderBoard(doc: Y.Doc) {
  return render(<BoardShell viewport={VIEWPORT} doc={doc} />);
}

/** A pointer event the delegated pointer handlers accept. */
function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
}

function windowKey(keyName: string) {
  act(() => {
    fireEvent(window, new KeyboardEvent('keydown', { key: keyName, bubbles: true }));
  });
}

function shapeToolOverlay(): HTMLElement {
  return screen.getByTestId('shape-tool') as HTMLElement;
}

function shapeButton(): HTMLButtonElement {
  return screen.getByTestId('tool-shape') as HTMLButtonElement;
}

/** Every `shape` record in the doc, as plain data. */
function shapes(doc: Y.Doc) {
  const out: Array<{ id: string; kind: string; fill: string; stroke: string; label: string }> = [];
  doc.getMap<Y.Map<unknown>>('objects').forEach((record, id) => {
    if (record.get('type') !== 'shape') return;
    out.push({
      id,
      kind: String(record.get('kind')),
      fill: String(record.get('fill')),
      stroke: String(record.get('stroke')),
      label: String((record.get('label') as Y.Text | undefined)?.toString() ?? ''),
    });
  });
  return out;
}

/** One full tool gesture: press at `from`, travel to `to`, release there. */
function dragOn(tool: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent(tool, pointer('pointerdown', from[0], from[1]));
  fireEvent(tool, pointer('pointermove', to[0], to[1]));
  fireEvent(tool, pointer('pointerup', to[0], to[1]));
}

describe('Shape tool (TC-15, TC-28)', () => {
  // TC-15: S activates the tool, a drag previews a box and creates exactly one
  // shape of the dragged size, which then becomes the selection.
  it('TC-15 — a Shape-tool drag shows a preview, creates one shape and selects it', () => {
    const doc = freshDoc();
    renderBoard(doc);

    windowKey('s');
    expect(shapeButton().getAttribute('aria-pressed')).toBe('true');
    const tool = shapeToolOverlay();

    // The tool layer is painted after the world layer, so it is what a pointer
    // meets first anywhere on the board.
    const world = screen.getByTestId('world-layer');
    // eslint-disable-next-line no-bitwise
    expect(world.compareDocumentPosition(tool) & 4).toBe(4); // 4 = following node

    // Travel is read while the pointer is down, so the preview must exist
    // before the release.
    fireEvent(tool, pointer('pointerdown', 100, 100));
    fireEvent(tool, pointer('pointermove', 300, 220));
    expect(screen.getByTestId('shape-preview')).toBeTruthy();

    fireEvent(tool, pointer('pointerup', 300, 220));

    const created = shapes(doc);
    expect(created).toHaveLength(1);
    // Screen 200x120 at zoom 1 is the same rectangle in world units, with the
    // default camera (x -400, y -300) offsetting it.
    const snap = snapshot(doc).find((obj) => obj.id === created[0].id)!;
    expect(snap.width).toBeCloseTo(200, 1);
    expect(snap.height).toBeCloseTo(120, 1);
    expect(snap.x).toBeCloseTo(-300, 1);
    expect(snap.y).toBeCloseTo(-200, 1);

    // The new shape is selected and the tool dropped back to Select.
    const el = screen.getByTestId(`shape-${created[0].id}`) as HTMLElement;
    expect(el.getAttribute('data-selected')).toBe('true');
    expect(shapeButton().getAttribute('aria-pressed')).toBe('false');
  });

  // TC-15 boundary: a drag under the travel threshold is a click → the default
  // 160x160 shape, never a tiny one.
  it('TC-15b — a two-pixel drag creates the default-size shape, not a sliver', () => {
    const doc = freshDoc();
    renderBoard(doc);
    windowKey('s');
    const tool = shapeToolOverlay();
    dragOn(tool, [400, 300], [402, 301]);

    const created = shapes(doc);
    expect(created).toHaveLength(1);
    const snap = snapshot(doc).find((obj) => obj.id === created[0].id)!;
    expect(snap.width).toBe(160);
    expect(snap.height).toBe(160);
  });

  // TC-28 (negative): the tool owns the gesture, so a drag that starts over an
  // existing sticky never moves it.
  it('TC-28 — a Shape-tool drag over a sticky leaves the sticky where it was', () => {
    const doc = freshDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    renderBoard(doc);

    const before = snapshot(doc).find((obj) => obj.id === stickyId)!;
    windowKey('s');
    dragOn(shapeToolOverlay(), [200, 200], [420, 340]);

    const after = snapshot(doc).find((obj) => obj.id === stickyId)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // The gesture still made exactly one shape, and nothing else moved.
    expect(shapes(doc)).toHaveLength(1);
  });
});

describe('Shape label and toolbar (TC-16, TC-17)', () => {
  function seedShape(doc: Y.Doc, x: number, y: number, kind = 'rect'): string {
    const id = createShape(doc, { kind: kind as never, rect: { x, y, width: 200, height: 120 }, at: { x, y } }, 'tester');
    if (id === null) throw new Error('seed shape failed');
    return id;
  }

  // TC-16: double-click opens the label editor; a 600-character label is
  // clamped to SHAPE_LABEL_MAX_CHARS (500).
  it('TC-16 — double-click opens the label editor and clamps 600 characters to 500', () => {
    const doc = freshDoc();
    const id = seedShape(doc, -100, -60);
    renderBoard(doc);

    const shape = screen.getByTestId(`shape-${id}`) as HTMLElement;
    fireEvent.doubleClick(shape);

    const editor = screen.getByTestId(`shape-editor-${id}`) as HTMLTextAreaElement;
    expect(editor).toBeTruthy();

    const long = 'x'.repeat(600);
    fireEvent.change(editor, { target: { value: long } });
    const label = doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('label') as Y.Text;
    expect(label.toString().length).toBe(500);
  });

  // TC-17: the two swatch rows change fill and outline; the label and the
  // selection survive the recolour.
  it('TC-17 — fill and outline swatches recolour without touching label or selection', () => {
    const doc = freshDoc();
    const id = seedShape(doc, -100, -60);
    const labelY = doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('label') as Y.Text;
    labelY.insert(0, 'Checkout');
    renderBoard(doc);

    const shape = screen.getByTestId(`shape-${id}`) as HTMLElement;
    // Select it first (the toolbar only exists for a one-item selection).
    fireEvent(shape, pointer('pointerdown', 300, 300));
    fireEvent(shape, pointer('pointerup', 300, 300));
    expect(shape.getAttribute('data-selected')).toBe('true');

    fireEvent.click(screen.getByTestId('fill-blue'));
    fireEvent.click(screen.getByTestId('stroke-red'));

    const record = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    expect(record.get('fill')).toBe('blue');
    expect(record.get('stroke')).toBe('red');
    // Unchanged: the label text and the single-item selection.
    expect((record.get('label') as Y.Text).toString()).toBe('Checkout');
    expect((screen.getByTestId(`shape-${id}`) as HTMLElement).getAttribute('data-selected')).toBe(
      'true',
    );
    // Still exactly one selected shape, so its toolbar is still mounted.
    expect(screen.getByTestId('shape-toolbar')).toBeTruthy();
  });

  // The toolbar reflects the current colours, and *no fill* is a real choice.
  it('TC-17b — the pressed swatch matches the stored colours, including "no fill"', () => {
    const doc = freshDoc();
    const id = seedShape(doc, -100, -60);
    renderBoard(doc);
    const shape = screen.getByTestId(`shape-${id}`) as HTMLElement;
    fireEvent(shape, pointer('pointerdown', 300, 300));
    fireEvent(shape, pointer('pointerup', 300, 300));

    expect((screen.getByTestId('fill-white') as HTMLButtonElement).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByTestId('fill-none'));
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    expect(record.get('fill')).toBe('none');
    expect((screen.getByTestId('fill-none') as HTMLButtonElement).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  // A read-only board offers no label editor and no recolouring.
  it('TC-17c — a read-only board neither opens the label nor changes colours', () => {
    const doc = freshDoc();
    const id = seedShape(doc, -100, -60);
    render(<BoardShell viewport={VIEWPORT} doc={doc} connectionState="load_failed" />);

    const shape = screen.getByTestId(`shape-${id}`) as HTMLElement;
    expect(shape.getAttribute('data-editable')).toBe('false');
    fireEvent.doubleClick(shape);
    expect(screen.queryByTestId(`shape-editor-${id}`)).toBeNull();

    // Even a forced pointer sequence on a swatch cannot recolour: the toolbar is
    // not shown for a read-only board.
    expect(screen.queryByTestId('shape-toolbar')).toBeNull();
    expect(doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('fill')).toBe('white');
  });
});
