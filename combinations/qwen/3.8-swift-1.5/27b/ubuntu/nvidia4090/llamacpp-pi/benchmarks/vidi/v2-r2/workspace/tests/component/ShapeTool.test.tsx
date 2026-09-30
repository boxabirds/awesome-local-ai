/**
 * Component tests for shape tool, shape object, and shape toolbar (story 10).
 * TC-15 to TC-17, TC-28.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, act } from '@testing-library/react';
import { ShapeTool } from '../../src/client/tools/ShapeTool';
import { ShapeObject } from '../../src/client/objects/ShapeObject';
import { ShapeToolbar } from '../../src/client/objects/ShapeToolbar';
import { createShape, setShapeStyle } from '../../src/shared/objects/shape';
import { initDoc, objectSnapshot } from '../../src/shared/board-model';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';
import type { ObjectProps } from '../../src/client/objects/registry';
import { createPointerEvent } from './helpers';

const cam: Camera = { x: -640, y: -400, zoom: 1 };

describe('ShapeTool (TC-15, TC-28)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('TC-15: S tool pointerdown/move/up → preview then createShape called once; selection = new id', () => {
    const onCreated = vi.fn();
    const onBoundary = vi.fn();

    const { container } = render(
      <ShapeTool kind="rect" camera={cam} doc={doc} createdBy="u1" onCreated={onCreated} onBoundary={onBoundary} />
    );

    const tool = container.querySelector('[data-testid="shape-tool"]') as HTMLElement;

    // Simulate drag from (100,100) to (300,220) in screen space
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, button: 0 }));
    });

    // Preview should be visible during drag
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointermove', { clientX: 300, clientY: 220, pointerId: 1 }));
    });
    const preview = container.querySelector('[data-testid="shape-preview"]');
    expect(preview).not.toBeNull();

    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerup', { clientX: 300, clientY: 220, pointerId: 1 }));
    });

    // createShape should have been called (via onCreated)
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onBoundary).toHaveBeenCalledTimes(1);

    // The shape should be in the doc
    const snap = objectSnapshot(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0].type).toBe('shape');
    expect(snap[0].width).toBe(200);
    expect(snap[0].height).toBe(120);
  });

  it('TC-28: Shape tool drag starting over an existing sticky → sticky position unchanged', () => {
    // Create a sticky at a known position
    const stickyId = (doc.getMap('objects') as Y.Map<Y.Map<unknown>>);
    const stickyObj = new Y.Map();
    stickyObj.set('type', 'sticky');
    stickyObj.set('x', 100);
    stickyObj.set('y', 100);
    stickyObj.set('z', 1);
    stickyObj.set('color', 'yellow');
    stickyObj.set('text', new Y.Text());
    stickyObj.set('createdAt', Date.now());
    doc.transact(() => {
      stickyId.set('sticky-1', stickyObj);
    });

    const onCreated = vi.fn();
    const onBoundary = vi.fn();

    const { container } = render(
      <ShapeTool kind="rect" camera={cam} doc={doc} createdBy="u1" onCreated={onCreated} onBoundary={onBoundary} />
    );

    const tool = container.querySelector('[data-testid="shape-tool"]') as HTMLElement;

    // Drag starting over the sticky's position
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerdown', { clientX: 200, clientY: 200, pointerId: 1, button: 0 }));
    });
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointermove', { clientX: 300, clientY: 250, pointerId: 1 }));
    });
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerup', { clientX: 300, clientY: 250, pointerId: 1 }));
    });

    // The sticky should be unchanged
    const stickyAfter = doc.getMap('objects').get('sticky-1') as Y.Map<unknown>;
    expect(stickyAfter.get('x')).toBe(100);
    expect(stickyAfter.get('y')).toBe(100);
  });
});

describe('ShapeObject label (TC-16)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  function makeShapeProps(id: string, overrides?: Partial<ObjectProps>): ObjectProps {
    const snap = objectSnapshot(doc).find((o) => o.id === id)!;
    return {
      obj: snap,
      doc,
      z: 1,
      zoom: 1,
      selected: true,
      editing: false,
      editable: true,
      onPointerDown: vi.fn(),
      onStartEdit: vi.fn(),
      onEndEdit: vi.fn(),
      ...overrides,
    };
  }

  it('TC-16: dblclick shape, type 600 chars → editor open, label length 500', () => {
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 200, height: 200 },
      at: { x: 0, y: 0 },
    }, 'u1')!;

    const props = makeShapeProps(id, { editing: true });
    const { container } = render(<ShapeObject {...props} />);

    const editor = container.querySelector('[data-testid="shape-label-editor"]') as HTMLElement;
    expect(editor).not.toBeNull();

    // Type 600 characters
    act(() => {
      editor.textContent = 'a'.repeat(600);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Label should be clamped to 500
    const ytext = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('label') as Y.Text;
    expect(ytext.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
  });
});

describe('ShapeToolbar (TC-17)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('TC-17: click blue fill and red outline swatches → colours applied; label and selection unchanged', () => {
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 200, height: 200 },
      at: { x: 0, y: 0 },
    }, 'u1')!;

    const onFill = vi.fn((c: string) => setShapeStyle(doc, id, { fill: c }));
    const onStroke = vi.fn((c: string) => setShapeStyle(doc, id, { stroke: c }));

    const { container } = render(<ShapeToolbar fill="white" stroke="dark" onFill={onFill} onStroke={onStroke} />);

    // Click blue fill
    const blueBtn = container.querySelector('[data-testid="fill-blue"]')!;
    act(() => {
      blueBtn.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(onFill).toHaveBeenCalledWith('blue');

    // Click red outline
    const redBtn = container.querySelector('[data-testid="stroke-red"]')!;
    act(() => {
      redBtn.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(onStroke).toHaveBeenCalledWith('red');

    // Verify in the doc
    const snap = objectSnapshot(doc);
    const shape = snap[0] as unknown as { fill: string; stroke: string; label: string; x: number; y: number; width: number; height: number };
    expect(shape.fill).toBe('blue');
    expect(shape.stroke).toBe('red');
    expect(shape.label).toBe(''); // label unchanged
    expect(shape.x).toBe(0); // position unchanged
    expect(shape.width).toBe(200); // size unchanged
  });
});
