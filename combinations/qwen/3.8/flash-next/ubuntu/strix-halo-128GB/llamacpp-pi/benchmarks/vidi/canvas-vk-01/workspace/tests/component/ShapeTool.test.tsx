import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { initDoc, objectSnapshots } from '../../src/shared/board-model';
import { getShapeLabel } from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import { seedBox, seedShape } from '../fixtures/boards';
import { fireKey, firePointer } from './helpers';

/**
 * Story 10 shape UI: the Shape tool's drag and click (`shape.create_drag`,
 * `shape.create_click`), the label editor (`shape.label`), the colour toolbar
 * (`shape.style`) and the rule that a drawing tool never moves what is under it.
 */

function renderEditable() {
  const doc = new Y.Doc();
  initDoc(doc);
  const view = render(<BoardApp doc={doc} />);
  return {
    ...view,
    doc,
    async settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    },
  };
}

const pressed = (testId: string): boolean =>
  screen.getByTestId(testId).getAttribute('aria-pressed') === 'true';

const camera = () => window.__vidi6?.getCamera() ?? { x: 0, y: 0, zoom: 1 };
const toWorld = (x: number, y: number) => screenToWorld(camera(), { x, y });
/** Shape snapshots with the box fields narrowed to numbers. */
interface ShapeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: string;
}

const shapes = (doc: Y.Doc): ShapeBox[] =>
  objectSnapshots(doc)
    .filter((obj) => obj.type === 'shape')
    .map((obj) => ({
      id: obj.id,
      x: obj.x,
      y: obj.y,
      width: obj.width ?? 0,
      height: obj.height ?? 0,
      kind: (obj as { kind: string }).kind,
    }));

/** Client coordinates of a world point, for firing pointers where the board shows it. */
function clientOf(world: { x: number; y: number }): { x: number; y: number } {
  const c = camera();
  return { x: world.x * c.zoom + c.x, y: world.y * c.zoom + c.y };
}

afterEach(cleanup);

describe('TC-15: the Shape tool drags a shape into being', () => {
  it('shows a preview, creates once on release, and selects the new shape', async () => {
    const { doc, settle } = renderEditable();
    await settle();

    fireKey({ key: 's' });
    await settle();
    expect(pressed('tool-shape')).toBe(true);
    const layer = screen.getByTestId('shape-tool-layer');

    firePointer(layer, 'pointerdown', 100, 100);
    expect(screen.getByTestId('shape-preview').style.width).toBe('0px');

    firePointer(layer, 'pointermove', 300, 220);
    const preview = screen.getByTestId('shape-preview');
    // The preview is screen-space: exactly the dragged area, not the board.
    expect(preview.style.width).toBe('200px');
    expect(preview.style.height).toBe('120px');

    firePointer(layer, 'pointerup', 300, 220);
    await settle();

    const created = shapes(doc);
    expect(created.length).toBe(1);
    const shape = created[0]!;
    const from = toWorld(100, 100);
    const to = toWorld(300, 220);
    expect(shape.x).toBeCloseTo(from.x, 1);
    expect(shape.y).toBeCloseTo(from.y, 1);
    expect(shape.width).toBeCloseTo(to.x - from.x, 1);
    expect(shape.height).toBeCloseTo(to.y - from.y, 1);

    // Selected, and the tool is back to Select.
    expect(screen.getByTestId(`shape-object-${shape.id}`).dataset.selected).toBe('true');
    expect(pressed('tool-select')).toBe(true);
    expect(screen.queryByTestId('shape-preview')).toBeNull();
  });

  it('Shift while dragging makes it square', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    fireKey({ key: 's' });
    await settle();
    const layer = screen.getByTestId('shape-tool-layer');

    firePointer(layer, 'pointerdown', 100, 100);
    firePointer(layer, 'pointermove', 300, 160, { shiftKey: true });
    expect(screen.getByTestId('shape-preview').style.width).toBe('200px');
    expect(screen.getByTestId('shape-preview').style.height).toBe('200px');
    firePointer(layer, 'pointerup', 300, 160, { shiftKey: true });
    await settle();

    const shape = shapes(doc)[0]!;
    expect(shape.width).toBeCloseTo(shape.height, 1);
  });

  it('a click creates a standard-size shape centred on the point', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    fireKey({ key: 's' });
    await settle();
    const layer = screen.getByTestId('shape-tool-layer');

    firePointer(layer, 'pointerdown', 400, 300);
    firePointer(layer, 'pointerup', 400, 300);
    await settle();

    const shape = shapes(doc)[0]!;
    const at = toWorld(400, 300);
    expect(shape.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 1);
    expect(shape.height).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 1);
    expect(shape.x + shape.width / 2).toBeCloseTo(at.x, 0);
    expect(shape.y + shape.height / 2).toBeCloseTo(at.y, 0);
  });

  it('a drag too small to be a drag still makes the standard shape', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    fireKey({ key: 's' });
    await settle();
    const layer = screen.getByTestId('shape-tool-layer');

    firePointer(layer, 'pointerdown', 200, 200);
    firePointer(layer, 'pointermove', 204, 203);
    firePointer(layer, 'pointerup', 204, 203);
    await settle();

    expect(shapes(doc)[0]!.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 1);
  });
});

describe('TC-16: the label editor', () => {
  it('opens on double-click, shares the text, and stops at the limit', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    const id = seedShape(doc, { x: 100, y: 100, width: 200, height: 120, label: 'Draft' });
    await settle();

    const node = screen.getByTestId(`shape-object-${id}`);
    const center = clientOf({ x: 200, y: 160 });
    firePointer(node, 'pointerdown', center.x, center.y);
    firePointer(node, 'pointerup', center.x, center.y);
    await settle();
    fireEvent.dblClick(node);
    await settle();

    const textarea = screen.getByTestId(`shape-textarea-${id}`) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Draft');

    // Typing beyond the limit is clipped to SHAPE_LABEL_MAX_CHARS (`shape.label`).
    const tooLong = 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 100);
    act(() => {
      fireEvent.input(textarea, { target: { value: tooLong } });
    });
    await settle();
    expect((getShapeLabel(doc, id) ?? new Y.Text()).toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(objectSnapshots(doc).filter((obj) => obj.id === id)[0]!.type).toBe('shape');

    // Escape ends editing without losing the text.
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape', bubbles: true, cancelable: true });
    });
    await settle();
    expect(screen.queryByTestId(`shape-textarea-${id}`)).toBeNull();
    expect(screen.getByTestId(`shape-label-${id}`).textContent).toHaveLength(
      SHAPE_LABEL_MAX_CHARS,
    );
  });
});

describe('TC-17: the colour toolbar changes colour only', () => {
  it('applies a fill and an outline, leaving label and selection alone', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    const id = seedShape(doc, { x: 100, y: 100, width: 200, height: 120, label: 'Keep me' });
    await settle();

    const node = screen.getByTestId(`shape-object-${id}`);
    const center = clientOf({ x: 200, y: 160 });
    firePointer(node, 'pointerdown', center.x, center.y);
    firePointer(node, 'pointerup', center.x, center.y);
    await settle();

    expect(screen.getByTestId('shape-toolbar')).toBeDefined();
    act(() => {
      fireEvent.click(screen.getByTestId('shape-fill-blue'));
    });
    await settle();
    act(() => {
      fireEvent.click(screen.getByTestId('shape-stroke-red'));
    });
    await settle();

    const shape = objectSnapshots(doc).find((obj) => obj.id === id)!;
    expect((shape as { fill: string }).fill).toBe('blue');
    expect((shape as { stroke: string }).stroke).toBe('red');
    expect((shape as { label: string }).label).toBe('Keep me');
    expect(screen.getByTestId(`shape-object-${id}`).dataset.selected).toBe('true');
    // The rendered SVG follows the document.
    const body = node.querySelector('[data-part="shape-body"]');
    expect(body?.getAttribute('fill')).toBe(SHAPE_FILL_COLORS.blue);
    expect(body?.getAttribute('stroke')).toBe(SHAPE_STROKE_COLORS.red);
  });
});

describe('undo: story 8 boundaries apply to shapes', () => {
  const undoButton = (): HTMLButtonElement => screen.getByLabelText('Undo') as HTMLButtonElement;

  it('one undo removes a shape that was just drawn', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    expect(undoButton().disabled).toBe(true);

    fireKey({ key: 's' });
    await settle();
    const layer = screen.getByTestId('shape-tool-layer');
    firePointer(layer, 'pointerdown', 400, 300);
    firePointer(layer, 'pointerup', 400, 300);
    await settle();
    expect(shapes(doc)).toHaveLength(1);

    act(() => {
      undoButton().click();
    });
    await settle();

    expect(shapes(doc)).toHaveLength(0);
    // Nothing else was in the step, so there is nothing left to undo.
    expect(objectSnapshots(doc)).toHaveLength(0);
    expect(undoButton().disabled).toBe(true);
  });

  it('a recolour is its own step: the shape stays, only the colour goes back', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    fireKey({ key: 's' });
    await settle();
    const layer = screen.getByTestId('shape-tool-layer');
    firePointer(layer, 'pointerdown', 400, 300);
    firePointer(layer, 'pointerup', 400, 300);
    await settle();

    // The new shape is selected, so its colour toolbar is up; recolour it.
    const drawn = shapes(doc)[0]!;
    const asDrawn = objectSnapshots(doc).find((obj) => obj.id === drawn.id)!;
    act(() => {
      fireEvent.click(screen.getByTestId('shape-fill-blue'));
    });
    await settle();

    act(() => {
      undoButton().click();
    });
    await settle();

    const afterOneUndo = objectSnapshots(doc).find((obj) => obj.id === drawn.id);
    expect(afterOneUndo).toBeDefined();
    expect((afterOneUndo as { fill: string }).fill).toBe((asDrawn as { fill: string }).fill);

    act(() => {
      undoButton().click();
    });
    await settle();
    expect(shapes(doc)).toHaveLength(0);
  });
});

describe('TC-28: a drawing tool leaves the board alone', () => {
  it('a Shape-tool drag that starts over a sticky note does not move it', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    const stickyId = seedBox(doc, { x: 100, y: 100 }, 120);
    await settle();
    const before = objectSnapshots(doc).find((obj) => obj.id === stickyId)!;

    fireKey({ key: 's' });
    await settle();
    const layer = screen.getByTestId('shape-tool-layer');
    const center = clientOf({ x: 160, y: 160 });
    firePointer(layer, 'pointerdown', center.x, center.y);
    firePointer(layer, 'pointermove', center.x + 180, center.y + 140);
    firePointer(layer, 'pointerup', center.x + 180, center.y + 140);
    await settle();

    const after = objectSnapshots(doc).find((obj) => obj.id === stickyId)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // and the drag drew a shape instead
    expect(shapes(doc).length).toBe(1);
  });
});
