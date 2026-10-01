import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_FILL_COLORS, SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_COLORS } from '../../src/shared/config';
import { notes, viewport } from './helpers';
import { box, drag, drawShape, key, layer, origin, shapes } from './shapeHelpers';

afterEach(cleanup);

describe('shape tool', () => {
  it('TC-15 dragging with the Shape tool previews, then creates one shape that is selected', () => {
    render(<App />);
    key('s');
    expect(screen.getByRole('button', { name: 'Shape (S)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Rectangle' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.pointerDown(layer(), { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(layer(), { clientX: 300, clientY: 220, pointerId: 1 });
    const preview = screen.getByTestId('shape-preview');
    expect(preview.style.width).toBe('200px');
    expect(preview.style.height).toBe('120px');
    fireEvent.pointerUp(layer(), { clientX: 300, clientY: 220, pointerId: 1 });
    expect(screen.queryByTestId('shape-preview')).toBeNull();
    expect(shapes()).toHaveLength(1);
    const o = origin();
    expect(box(shapes()[0])).toEqual({ x: 100 + o.x, y: 100 + o.y, width: 200, height: 120 });
    expect(shapes()[0].dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('shape-tool-layer')).toBeNull();
  });

  it('a click drops a standard 160x160 shape centred on the click, a tiny drag does the same', () => {
    render(<App />);
    key('s');
    drag(layer(), [400, 300], [400, 300]);
    const o = origin();
    expect(box(shapes()[0])).toEqual({
      x: 400 + o.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: 300 + o.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
    key('s');
    drag(layer(), [700, 300], [710, 600]);
    expect(shapes().map((s) => box(s).width)).toEqual([SHAPE_DEFAULT_SIZE_WORLD, SHAPE_DEFAULT_SIZE_WORLD]);
  });

  it('Shift makes the new shape square using the larger dimension; the kind menu picks Ellipse and Diamond', () => {
    render(<App />);
    key('s');
    fireEvent.click(screen.getByRole('button', { name: 'Diamond' }));
    drag(layer(), [100, 100], [300, 220], { shiftKey: true });
    const kind = (k: string) => shapes().find((s) => s.dataset.shapeKind === k) as HTMLElement;
    expect(kind('diamond')).toBeTruthy();
    expect(box(kind('diamond'))).toMatchObject({ width: 200, height: 200 });
    key('s');
    fireEvent.click(screen.getByRole('button', { name: 'Ellipse' }));
    drag(layer(), [600, 400], [500, 300]);
    expect(kind('ellipse')).toBeTruthy();
    expect(box(kind('ellipse'))).toMatchObject({ width: 100, height: 100 });
  });

  it('TC-22 Escape with the Shape tool active returns to Select and creates nothing, even mid-drag', () => {
    render(<App />);
    key('s');
    fireEvent.pointerDown(layer(), { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(layer(), { clientX: 200, clientY: 200, pointerId: 1 });
    key('Escape');
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('shape-tool-layer')).toBeNull();
    expect(shapes()).toHaveLength(0);
  });

  it('pointercancel creates nothing and keeps the tool', () => {
    render(<App />);
    key('s');
    fireEvent.pointerDown(layer(), { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(layer(), { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerCancel(layer(), { pointerId: 1 });
    expect(shapes()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Shape (S)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-28 dragging from over an existing sticky with the Shape tool does not move the sticky', () => {
    render(<App />);
    fireEvent.doubleClick(viewport(), { clientX: 300, clientY: 300 });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    const note = notes()[0];
    const before = { left: note.style.left, top: note.style.top };
    key('s');
    drag(layer(), [310, 310], [500, 420]);
    expect({ left: notes()[0].style.left, top: notes()[0].style.top }).toEqual(before);
    expect(shapes()).toHaveLength(1);
  });

  it('TC-16 double-clicking a shape edits its label, which stops at 500 characters', () => {
    render(<App />);
    drawShape([100, 100], [300, 220]);
    fireEvent.doubleClick(shapes()[0]);
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: 'x'.repeat(600) } });
    expect(editor.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(shapes()[0].textContent).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(shapes()[0].getAttribute('aria-label')).toBe(`Rectangle: ${'x'.repeat(SHAPE_LABEL_MAX_CHARS)}`);
  });

  it('TC-17 picking fill and outline swatches recolours the shape and keeps label, size and selection', () => {
    render(<App />);
    drawShape([100, 100], [300, 220]);
    fireEvent.doubleClick(shapes()[0]);
    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Checkout' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    const before = box(shapes()[0]);
    expect(shapes()[0].dataset.selected).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'red outline' }));
    const rect = shapes()[0].querySelector('rect') as SVGRectElement;
    expect(rect.getAttribute('fill')).toBe(SHAPE_FILL_COLORS.blue);
    expect(rect.getAttribute('stroke')).toBe(SHAPE_STROKE_COLORS.red);
    expect(shapes()[0].textContent).toBe('Checkout');
    expect(box(shapes()[0])).toEqual(before);
    expect(shapes()[0].dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'red outline' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'none fill' }));
    expect((shapes()[0].querySelector('rect') as SVGRectElement).getAttribute('fill')).toBe('transparent');
  });

  it('offers six fill colours plus no fill and six outline colours', () => {
    render(<App />);
    drawShape([100, 100], [300, 220]);
    expect(document.querySelectorAll('[aria-label$=" fill"]')).toHaveLength(7);
    expect(document.querySelectorAll('[aria-label$=" outline"]')).toHaveLength(6);
  });

  it('a shape is announced with its kind', () => {
    render(<App />);
    drawShape([100, 100], [300, 220], 'Ellipse');
    expect(screen.getByRole('group', { name: 'Ellipse' })).toBeTruthy();
  });
});
