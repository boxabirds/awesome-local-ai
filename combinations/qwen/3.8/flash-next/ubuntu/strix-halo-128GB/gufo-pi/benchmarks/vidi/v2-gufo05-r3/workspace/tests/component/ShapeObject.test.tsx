/**
 * Component tests for the shape object's drawing (shape.create, shape.follow).
 *
 * What a shape *is* on the screen — which figure, in which two colours, with the label
 * centred in the box — is asserted here, together with the one claim that spans two
 * objects: dragging a shape whose side an arrow is joined to moves the arrow's end with
 * it, because both are read from the same document.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import * as Y from 'yjs';
import App from '../../src/client/App';
import { stubViewportSize } from './boardHarness';
import {
  bodyOf,
  findConnector,
  findShape,
  screenOf,
  seedConnector,
  seedShape,
} from './flowHarness';
import { objectBounds } from '../../src/shared/board-model';

stubViewportSize();

describe('shape object (shape.label, shape.style)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  const centreScreen = (container: HTMLElement, id: string): { x: number; y: number } => {
    const bounds = objectBounds(findShape(doc, id));
    return screenOf(container, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  };

  /** Press on the shape and let go without moving: that selects it. */
  function selectShape(container: HTMLElement, id: string): void {
    const at = centreScreen(container, id);
    const body = bodyOf(container, id);
    fireEvent.pointerDown(body, { clientX: at.x, clientY: at.y, button: 0, pointerId: 21 });
    fireEvent.pointerUp(window, { clientX: at.x, clientY: at.y, button: 0, pointerId: 21 });
  }

  /** The drawn figure inside a shape's SVG: rect, ellipse or polygon. */
  const figureOf = (container: HTMLElement, id: string): Element => {
    const figure = container.querySelector(`[data-testid="shape-body-${id}"] > *`);
    if (!figure) throw new Error(`shape ${id} drew nothing`);
    return figure;
  };

  it('draws the kind, the colours and the centred label', () => {
    const id = seedShape(doc, 'ellipse', { x: 0, y: 0, width: 200, height: 120 }, { label: 'Start here' });
    const { container } = render(<App doc={doc} />);

    const figure = figureOf(container, id);
    expect(figure.tagName.toLowerCase()).toBe('ellipse');
    expect(figure.getAttribute('fill')).toBe('#FFFFFF');
    expect(figure.getAttribute('stroke')).toBe('#263238');

    const label = container.querySelector<HTMLElement>(`[data-testid="shape-label-${id}"]`);
    if (!label) throw new Error('the shape rendered no label');
    expect(label.textContent).toBe('Start here');
    expect(label.style.textAlign).toBe('center');
    expect(label.style.wordBreak).toBe('break-word');
  });

  it('the diamond is a four pointed polygon and the rectangle is a rectangle', () => {
    const diamond = seedShape(doc, 'diamond', { x: 0, y: 0, width: 200, height: 160 });
    const rect = seedShape(doc, 'rect', { x: 400, y: 0, width: 200, height: 160 });
    const { container } = render(<App doc={doc} />);
    expect(figureOf(container, diamond).tagName.toLowerCase()).toBe('polygon');
    expect(figureOf(container, diamond).getAttribute('points')?.split(' ')).toHaveLength(4);
    expect(figureOf(container, rect).tagName.toLowerCase()).toBe('rect');
  });

  it('an arrow joined to the shape does not stop the shape from moving with its handle', () => {
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const b = seedShape(doc, 'rect', { x: 600, y: 0, width: 200, height: 120 });
    const arrow = seedConnector(doc, a, b);
    const { container } = render(<App doc={doc} />);

    selectShape(container, a);
    const before = findShape(doc, a);
    const start = centreScreen(container, a);
    const handle = container.querySelector<HTMLElement>('[data-resize-handle="se"]');
    if (!handle) throw new Error('a selected shape shows no resize handles');
    // Drag the shape itself by 40 screen pixels: the arrow follows, and the box moves.
    fireEvent.pointerDown(bodyOf(container, a), { clientX: start.x, clientY: start.y, button: 0, pointerId: 22 });
    fireEvent.pointerMove(window, { clientX: start.x + 40, clientY: start.y, button: 0, pointerId: 22 });
    fireEvent.pointerUp(window, { clientX: start.x + 40, clientY: start.y, button: 0, pointerId: 22 });

    expect(findShape(doc, a).x).toBe(before.x + 40);
    expect(findShape(doc, b).x).toBe(600);
    // The arrow is still joined to both, so its free-floating end moved with the shape
    // that owns it and the other end stayed where its own shape is.
    const ends = findConnector(doc, arrow).ends;
    expect(ends.from.x).toBeCloseTo(240, 6);
    expect(ends.to.x).toBeCloseTo(600, 6);
  });

  it('a selected shape shows the eight handles and nothing else grabs them', () => {
    const id = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const { container } = render(<App doc={doc} />);
    selectShape(container, id);
    expect(container.querySelectorAll('[data-resize-handle]')).toHaveLength(8);
    // The label is not an editing affordance: only a double-click opens it.
    expect(container.querySelector('[aria-label="Shape label"]')).toBeNull();
  });
});
