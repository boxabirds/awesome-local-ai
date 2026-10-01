import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { getShapeLabel, type ShapeSnap } from '../../src/shared/objects/shape';
import { camera, down, key, move, objectsOf, pressed, renderBoard, toScreen, up } from './shapes-helpers';

afterEach(cleanup);

const layer = () => screen.getByTestId('shape-tool-layer');

describe('shape.ui', () => {
  it('TC-15 S tool: pointerdown/move shows the preview, pointerup creates one shape and selects it', () => {
    const { doc } = renderBoard();
    key('s');
    expect(pressed('Shape (S)')).toBe('true');
    down(layer(), 100, 100);
    move(layer(), 300, 220);
    const preview = screen.getByTestId('shape-preview');
    expect(preview.style.width).toBe('200px');
    expect(preview.style.height).toBe('120px');
    up(layer(), 300, 220);
    const shapes = objectsOf(doc, 'shape') as ShapeSnap[];
    expect(shapes).toHaveLength(1);
    const c = camera();
    expect(shapes[0]).toMatchObject({ kind: 'rect', x: 100 / c.zoom + c.x, y: 100 / c.zoom + c.y, width: 200 / c.zoom, height: 120 / c.zoom });
    expect(screen.queryByTestId('shape-preview')).toBeNull();
    expect(screen.getByRole('group', { name: 'Rectangle' }).getAttribute('data-selected')).toBe('true');
    expect(pressed('Select (V)')).toBe('true');
  });

  it('a click drops a standard shape of the menu kind centred on the point; Shift squares a drag', () => {
    const { doc } = renderBoard();
    key('s');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Diamond' }));
    down(layer(), 400, 300);
    up(layer(), 400, 300);
    const c = camera();
    expect(objectsOf(doc, 'shape')[0]).toMatchObject({ kind: 'diamond', width: 160, height: 160, x: 400 / c.zoom + c.x - 80, y: 300 / c.zoom + c.y - 80 });
    key('s');
    down(layer(), 100, 100);
    move(layer(), 300, 220, { shiftKey: true });
    expect(screen.getByTestId('shape-preview').style.height).toBe('200px');
    up(layer(), 300, 220, { shiftKey: true });
    const second = objectsOf(doc, 'shape')[1];
    expect(second.width).toBe(second.height);
  });

  it('TC-16 double-click opens the label editor; typing stops at the character limit', () => {
    const { doc, ids } = renderBoard([{ x: 0, y: 0, w: 200, h: 120 }]);
    fireEvent.doubleClick(screen.getByRole('group', { name: 'Rectangle' }));
    const ta = screen.getByRole('textbox', { name: 'Shape label' }) as HTMLTextAreaElement;
    ta.value = 'x'.repeat(600);
    fireEvent.input(ta);
    expect(getShapeLabel(doc, ids[0])!.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(ta.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-17 fill and outline swatches change only the colours', () => {
    const { doc, ids } = renderBoard([{ x: 0, y: 0 }]);
    act(() => getShapeLabel(doc, ids[0])!.insert(0, 'Keep'));
    const group = screen.getByRole('group', { name: 'Rectangle: Keep' });
    down(group, 10, 10);
    up(group, 10, 10);
    fireEvent.click(screen.getByRole('button', { name: 'blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'red outline' }));
    const s = objectsOf(doc, 'shape')[0] as ShapeSnap;
    expect(s).toMatchObject({ fill: 'blue', stroke: 'red', label: 'Keep', width: 100, height: 100, x: 0, y: 0 });
    expect(screen.getByRole('group', { name: 'Rectangle: Keep' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getAllByRole('button', { name: /fill$/ })).toHaveLength(7);
    expect(screen.getAllByRole('button', { name: /outline$/ })).toHaveLength(6);
  });

  it('TC-28 a Shape-tool drag that starts over a sticky note does not move it', () => {
    const { doc } = renderBoard();
    const id = createSticky(doc, { x: 300, y: 300 });
    const before = snapshot(doc).find((o) => o.id === id)!;
    key('s');
    const at = toScreen({ x: 300, y: 300 });
    down(layer(), at.x, at.y);
    move(layer(), at.x + 150, at.y + 90);
    up(layer(), at.x + 150, at.y + 90);
    const after = snapshot(doc).find((o) => o.id === id)!;
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    expect(objectsOf(doc, 'shape')).toHaveLength(1);
  });
});
