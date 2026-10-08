/**
 * Story 10, shape ui-component tests (design TC-15 to TC-17, TC-28):
 * Shape-tool drag (preview + one createShape + return to Select), the
 * label editor clamped at SHAPE_LABEL_MAX_CHARS, the ShapeToolbar swatches,
 * and the negative case of a drag starting over an existing sticky.
 *
 * Fixture camera (harness): world (0,0) is at screen (640,400), zoom 1.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { createSticky, LOCAL_ORIGIN, snapshotAll } from '../../src/shared/board-model';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import { renderStickyBoard } from './harness';

afterEach(() => {
  vi.useRealTimers();
});

/** Window-level key press (useActiveTool listens on window keydown). */
function pressKey(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { key, ...init });
}

describe('story 10: shape tool (TC-15 to TC-17, TC-28)', () => {
  it('TC-15: S-tool drag shows a preview, creates one shape with the dragged rect, and selects it', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    pressKey('s');
    const layer = utils.getByTestId('shape-tool-layer');

    // Screen (500,300) → world (-140,-100); (700,420) → world (60,20).
    fireEvent.pointerDown(layer, { clientX: 500, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 700, clientY: 420, pointerId: 1 });

    // A preview is shown while the drag is in flight.
    expect(utils.getByTestId('shape-preview')).toBeTruthy();

    fireEvent.pointerUp(layer, { clientX: 700, clientY: 420, pointerId: 1 });

    const all = snapshotAll(utils.doc);
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('shape');
    expect(all[0].x).toBe(-140);
    expect(all[0].y).toBe(-100);
    expect(all[0].width).toBe(200);
    expect(all[0].height).toBe(120);

    // The preview is gone, the tool reverted to Select, and the new shape
    // is the selected object.
    expect(utils.queryByTestId('shape-tool-layer')).toBeNull();
    expect(utils.getByTestId('select-button').getAttribute('aria-pressed')).toBe('true');
    expect(utils.getByTestId('shape-object').getAttribute('data-selected')).toBe('true');
  });

  it('TC-16: double-click opens the label editor and input is clamped to SHAPE_LABEL_MAX_CHARS', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    let id: string | null = null;
    act(() => {
      id = createShape(
        utils.doc,
        {
          kind: 'rect',
          rect: { x: -80, y: -60, width: 160, height: 120 },
          at: { x: 0, y: 0 },
        },
        'test',
      );
    });
    expect(id).toBeTypeOf('string');

    // Double-click the shape: the label editor opens.
    fireEvent.doubleClick(utils.getByTestId('shape-object'), { clientX: 640, clientY: 400 });
    const ta = utils.getByTestId('shape-label-textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();

    // 600 characters typed: only the first SHAPE_LABEL_MAX_CHARS are kept.
    act(() => {
      ta.value = 'a'.repeat(600);
    });
    fireEvent.input(ta);

    expect(getShapeLabel(utils.doc, id!)!.toString()).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-17: the ShapeToolbar fill/outline swatches apply; label and selection are unchanged', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    let id: string | null = null;
    act(() => {
      id = createShape(
        utils.doc,
        {
          kind: 'rect',
          rect: { x: -80, y: -60, width: 160, height: 120 },
          at: { x: 0, y: 0 },
        },
        'test',
      );
      utils.doc.transact(
        () => {
          getShapeLabel(utils.doc, id!)?.insert(0, 'Hello');
        },
        LOCAL_ORIGIN,
      );
    });
    expect(id).toBeTypeOf('string');

    // Select the shape by clicking its centre.
    const el = utils.getByTestId('shape-object');
    fireEvent.pointerDown(el, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 640, clientY: 400, pointerId: 1 });

    // The Shape toolbar is shown for the single selected shape.
    expect(utils.getByTestId('shape-toolbar')).toBeTruthy();

    // Blue fill, red outline.
    fireEvent.click(utils.getByTestId('shape-fill-blue'));
    fireEvent.click(utils.getByTestId('shape-stroke-red'));

    const shape = snapshotAll(utils.doc).find((o) => o.id === id);
    expect(shape?.fill).toBe('blue');
    expect(shape?.stroke).toBe('red');
    // Label and selection are unchanged by the recolor.
    expect(getShapeLabel(utils.doc, id!)!.toString()).toBe('Hello');
    expect(utils.getByTestId('shape-object').getAttribute('data-selected')).toBe('true');
  });

  it('TC-28: a Shape-tool drag starting over a sticky does not move the sticky (negative)', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    let stickyId = '';
    act(() => {
      stickyId = createSticky(utils.doc, { x: 0, y: 0 });
    });
    expect(stickyId).not.toBe('');

    pressKey('s');
    const layer = utils.getByTestId('shape-tool-layer');

    // The sticky spans world (-100,-100)..(100,100); start the drag over it
    // and finish 200x100 world units away.
    fireEvent.pointerDown(layer, { clientX: 560, clientY: 360, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 760, clientY: 460, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 760, clientY: 460, pointerId: 1 });

    // The sticky stayed put …
    const sticky = snapshotAll(utils.doc).find((o) => o.id === stickyId);
    expect(sticky?.x).toBe(-100);
    expect(sticky?.y).toBe(-100);
    // … and the drag produced a shape instead.
    const shapes = snapshotAll(utils.doc).filter((o) => o.type === 'shape');
    expect(shapes).toHaveLength(1);
  });
});
