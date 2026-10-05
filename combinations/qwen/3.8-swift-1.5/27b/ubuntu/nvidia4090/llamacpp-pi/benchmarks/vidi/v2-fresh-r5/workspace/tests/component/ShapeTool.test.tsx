import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { ShapeTool } from '../../src/client/tools/ShapeTool';
import { ShapeObject } from '../../src/client/objects/ShapeObject';
import { ShapeToolbar } from '../../src/client/objects/ShapeToolbar';
import { createShape, setShapeStyle, getShapeLabel } from '../../src/shared/objects/shape';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';

const testCamera: Camera = { x: 0, y: 0, zoom: 1 };

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects');
  return doc;
}

describe('ShapeTool component', () => {
  // TC-15: S tool pointerdown/move/up → preview shown, createShape called once, selection = new id.
  it('TC-15: drag creates a shape and calls onCreated', () => {
    const doc = newDoc();
    const onCreated = vi.fn();

    const { container } = render(
      <ShapeTool kind="rect" camera={testCamera} doc={doc} onCreated={onCreated} />
    );

    const svg = container.querySelector('svg')!;

    // Simulate drag from (100,100) to (300,220)
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 220, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 220, pointerId: 1 });

    expect(onCreated).toHaveBeenCalledTimes(1);
    const id = onCreated.mock.calls[0][0];
    expect(id).toBeTypeOf('string');

    // Verify the shape was created in the doc
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(obj.get('width')).toBe(200);
    expect(obj.get('height')).toBe(120);
  });

  // TC-28: Shape tool drag starting over an existing sticky → sticky position unchanged (negative).
  it('TC-28: shape tool does not move existing objects', () => {
    const doc = newDoc();
    const onCreated = vi.fn();

    // Create a sticky note
    const objects = doc.getMap('objects');
    const stickyMap = new Y.Map<unknown>();
    stickyMap.set('type', 'sticky');
    stickyMap.set('x', 100);
    stickyMap.set('y', 100);
    stickyMap.set('color', 'yellow');
    stickyMap.set('text', new Y.Text());
    stickyMap.set('z', 1);
    stickyMap.set('createdAt', Date.now());
    doc.transact(() => {
      objects.set('sticky-1', stickyMap);
    });

    render(
      <ShapeTool kind="rect" camera={testCamera} doc={doc} onCreated={onCreated} />
    );

    // The ShapeTool captures all pointer events (overlay), so it never
    // delegates to objects. The sticky position should remain unchanged.
    const svg = document.querySelector('svg[data-testid="shape-tool-overlay"]')!;
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 250, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 250, clientY: 250, pointerId: 1 });

    // Sticky position unchanged
    expect(stickyMap.get('x')).toBe(100);
    expect(stickyMap.get('y')).toBe(100);
  });
});

describe('ShapeObject component', () => {
  // TC-16: dblclick shape, type 600 chars → editor open, label length SHAPE_LABEL_MAX_CHARS (boundary).
  it('TC-16: label editing clamps to max characters', () => {
    const doc = newDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 200, height: 100 },
      at: { x: 0, y: 0 },
    }, 'local')!;

    const obj = {
      id,
      type: 'shape' as const,
      x: 0, y: 0,
      width: 200, height: 100,
      text: '',
      z: 1,
      createdAt: Date.now(),
      kind: 'rect',
      fill: 'white',
      stroke: 'dark',
    };

    const onEndEdit = vi.fn();
    const { container } = render(
      <svg>
        <ShapeObject
          obj={obj as any}
          selected={true}
          editing={true}
          canEdit={true}
          onPointerDown={vi.fn()}
          onDoubleClick={vi.fn()}
          doc={doc}
          onEndEdit={onEndEdit}
        />
      </svg>
    );

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeDefined();

    // Type 600 characters
    const longText = 'a'.repeat(600);
    fireEvent.change(textarea, { target: { value: longText } });

    // Label should be clamped to SHAPE_LABEL_MAX_CHARS
    const label = getShapeLabel(doc, id);
    expect(label!.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
  });
});

describe('ShapeToolbar component', () => {
  // TC-17: click blue fill and red outline swatches → colours applied; label and selection unchanged.
  it('TC-17: fill and stroke swatches apply colours', () => {
    const doc = newDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 200, height: 100 },
      at: { x: 0, y: 0 },
    }, 'local')!;

    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    const label = obj.get('text') as Y.Text;
    label.insert(0, 'Test');

    const onFill = vi.fn((c: string) => setShapeStyle(doc, id, { fill: c }));
    const onStroke = vi.fn((c: string) => setShapeStyle(doc, id, { stroke: c }));

    render(
      <ShapeToolbar
        fill="white"
        stroke="dark"
        onFill={onFill}
        onStroke={onStroke}
      />
    );

    // Click blue fill
    const blueFill = screen.getByTestId('fill-blue');
    fireEvent.click(blueFill);
    expect(onFill).toHaveBeenCalledWith('blue');
    expect(obj.get('fill')).toBe('blue');

    // Click red stroke
    const redStroke = screen.getByTestId('stroke-red');
    fireEvent.click(redStroke);
    expect(onStroke).toHaveBeenCalledWith('red');
    expect(obj.get('stroke')).toBe('red');

    // Label unchanged
    expect(label.toString()).toBe('Test');
    // Size unchanged
    expect(obj.get('width')).toBe(200);
    expect(obj.get('height')).toBe(100);
  });
});
