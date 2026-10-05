/**
 * Component tests for the active tool (TC-22, tools.active_tool).
 *
 * A tool is UI state, so this is tested where UI state is tested: render the board,
 * press the key, look at the buttons and at the document. The two things that matter
 * about a tool are that it gives up when its work is done and that putting it down
 * makes nothing, and both are asserted against the document rather than against a
 * spy — a tool that "created" an object the board never got would otherwise pass.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import App from '../../src/client/App';
import { stubViewportSize } from './boardHarness';
import {
  bodyOf,
  cameraOf,
  objectsOf,
  screenOf,
  seedShape,
  toScreen,
} from './flowHarness';

stubViewportSize();

describe('active tool (tools.active_tool)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  const shapeButton = (): HTMLButtonElement =>
    screen.getByRole('button', { name: /^Shape \(S\)/ }) as HTMLButtonElement;
  const connectorButton = (): HTMLButtonElement =>
    screen.getByRole('button', { name: 'Connector (L)' }) as HTMLButtonElement;
  const layer = (container: HTMLElement, tool: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(`[data-tool-layer="${tool}"]`);

  /** Drag on the drawing layer, in screen pixels. */
  function dragLayer(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
    fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, button: 0, pointerId: 7 });
    fireEvent.pointerMove(window, { clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2, button: 0, pointerId: 7 });
    fireEvent.pointerUp(window, { clientX: to.x, clientY: to.y, button: 0, pointerId: 7 });
  }

  it('TC-22 creating a shape returns the tool to Select and leaves the shape selected', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 's' });
    expect(shapeButton().getAttribute('aria-pressed')).toBe('true');
    expect(layer(container, 'shape')).not.toBeNull();

    dragLayer(layer(container, 'shape')!, { x: 300, y: 200 }, { x: 500, y: 320 });

    expect(objectsOf(doc).filter((object) => object.type === 'shape')).toHaveLength(1);
    expect(shapeButton().getAttribute('aria-pressed')).toBe('false');
    // The tool is gone, and what it made is the selection.
    expect(layer(container, 'shape')).toBeNull();
    const selected = container.querySelectorAll<HTMLElement>('[data-object-type][data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.dataset.objectType).toBe('shape');
  });

  it('TC-22 creating an arrow returns the tool to Select and leaves the arrow selected', () => {
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const b = seedShape(doc, 'rect', { x: 600, y: 0, width: 200, height: 120 });
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'l' });
    expect(connectorButton().getAttribute('aria-pressed')).toBe('true');

    const from = screenOf(container, { x: 100, y: 60 });
    const to = screenOf(container, { x: 700, y: 60 });
    dragLayer(layer(container, 'connector')!, from, to);

    const arrows = objectsOf(doc).filter((object) => object.type === 'connector');
    expect(arrows).toHaveLength(1);
    expect(connectorButton().getAttribute('aria-pressed')).toBe('false');
    const selected = container.querySelectorAll<HTMLElement>('[data-object-type][data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.dataset.objectType).toBe('connector');
    expect(arrows[0]?.id).toBe([...arrows][0].id);
    void a;
    void b;
  });

  it('TC-22 Escape with the Shape tool active selects again and makes nothing (negative)', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 's' });
    // A drag under way, then Escape: the unfinished shape is not a shape.
    const shapeLayer = layer(container, 'shape')!;
    fireEvent.pointerDown(shapeLayer, { clientX: 300, clientY: 200, button: 0, pointerId: 8 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300, button: 0, pointerId: 8 });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(objectsOf(doc)).toHaveLength(0);
    expect(shapeButton().getAttribute('aria-pressed')).toBe('false');
    // Releasing afterwards cannot resurrect the draft: nothing is listening for it
    // in the tool any more, and the layer is gone.
    fireEvent.pointerUp(window, { clientX: 400, clientY: 300, button: 0, pointerId: 8 });
    expect(objectsOf(doc)).toHaveLength(0);
  });

  it('TC-22 Escape with the Connector tool active makes nothing (negative)', () => {
    seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'l' });
    const connectorLayer = layer(container, 'connector')!;
    fireEvent.pointerDown(connectorLayer, { clientX: 100, clientY: 60, button: 0, pointerId: 9 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 60, button: 0, pointerId: 9 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(connectorButton().getAttribute('aria-pressed')).toBe('false');
    expect(objectsOf(doc).filter((object) => object.type === 'connector')).toHaveLength(0);
  });

  it('the kind menu changes what the Shape tool will draw', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.click(screen.getByRole('button', { name: 'Shape kind menu' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Diamond' }));
    fireEvent.keyDown(window, { key: 's' });
    expect(layer(container, 'shape')?.dataset.shapeKind).toBe('diamond');
    expect(shapeButton().getAttribute('aria-label')).toBe('Shape (S) \u2013 Diamond');
  });

  it('the Shape button chooses the tool and keeps the kind already picked', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.click(screen.getByRole('button', { name: 'Shape kind menu' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ellipse' }));
    fireEvent.click(shapeButton());
    expect(shapeButton().getAttribute('aria-pressed')).toBe('true');
    expect(layer(container, 'shape')?.dataset.shapeKind).toBe('ellipse');
  });

  it('keys switch tools, and a key with no drawing behind it does nothing', () => {
    render(<App doc={doc} />);
    const textButton = screen.getByRole('button', { name: 'Text (T)' });

    fireEvent.keyDown(window, { key: 't' });
    expect(textButton.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'v' });
    expect(textButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(window, { key: 'l' });
    expect(connectorButton().getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'v' });
    expect(connectorButton().getAttribute('aria-pressed')).toBe('false');

    // Pen, image and comment have keys by convention and no drawing yet: the tool
    // stays where it was rather than becoming a mode that cannot be used.
    for (const key of ['p', 'i', 'c']) {
      fireEvent.keyDown(window, { key });
      expect(shapeButton().getAttribute('aria-pressed')).toBe('false');
      expect(connectorButton().getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('a tool key typed into the label editor types a letter instead (negative)', () => {
    const id = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 }, { label: '' });
    const { container } = render(<App doc={doc} />);
    // Put the caret in the shape's label.
    const centre = toScreen(cameraOf(container), { x: 100, y: 60 });
    fireEvent.doubleClick(bodyOf(container, id), { clientX: centre.x, clientY: centre.y });
    const editor = container.querySelector<HTMLTextAreaElement>('[aria-label="Shape label"]');
    if (!editor) throw new Error('the label editor did not open');
    fireEvent.keyDown(editor, { key: 's' });
    expect(shapeButton().getAttribute('aria-pressed')).toBe('false');
  });
});
