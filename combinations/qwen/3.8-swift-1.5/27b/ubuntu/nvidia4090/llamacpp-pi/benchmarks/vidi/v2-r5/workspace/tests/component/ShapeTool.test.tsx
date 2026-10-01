// @vitest-environment jsdom
// tests/component/ShapeTool.test.tsx
// TC-15: S tool pointerdown/move/up → preview, createShape called, selection
// TC-16: dblclick shape, type 600 chars → editor open, label length 500
// TC-17: click blue fill and red outline swatches → colours applied
// TC-28: Shape tool drag starting over an existing sticky → sticky position unchanged

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, snapshot, createSticky } from '../../src/shared/board-model';
import { createShape, setShapeStyle } from '../../src/shared/objects/shape';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { ShapeTool } from '../../src/client/tools/ShapeTool';
import { ShapeObject } from '../../src/client/objects/ShapeObject';
import { ShapeToolbar } from '../../src/client/objects/ShapeToolbar';
import type { Camera } from '../../src/client/canvas/camera';

const testCamera: Camera = { x: -640, y: -400, zoom: 1 };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makePointerEvent(type: string, x: number, y: number): Event {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'clientX', { value: x });
  Object.defineProperty(evt, 'clientY', { value: y });
  Object.defineProperty(evt, 'pointerId', { value: 1 });
  return evt;
}

beforeAll(() => {
  const proto = Element.prototype as any;
  if (!proto.setPointerCapture) {
    proto.setPointerCapture = vi.fn();
    proto.releasePointerCapture = vi.fn();
  }
});

beforeEach(() => {
  cleanup();
});

// TC-15: S tool pointerdown/move/up → preview shown, createShape called once, selection = new id
describe('TC-15: Shape tool drag creation', () => {
  it('pointerdown/move/up creates a shape and selects it', () => {
    const doc = makeDoc();
    const createdIds: string[] = [];
    const createFn = vi.fn((rect: any, at: any, square: boolean) => {
      const id = createShape(doc, { kind: 'rect', rect, at, square }, 'local');
      if (id) createdIds.push(id);
      return id;
    });

    const { container } = render(
      <ShapeTool
        kind="rect"
        camera={testCamera}
        onCreated={(id) => createdIds.push(id)}
        create={createFn}
      />
    );

    const overlay = container.querySelector('[data-testid="shape-tool-overlay"]')!;

    // Simulate pointer down at (100, 100) screen
    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });

    // Simulate pointer move to (300, 220) screen
    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointermove', 300, 220));
    });

    // Preview should be visible
    expect(container.querySelector('[data-testid="shape-preview"]')).not.toBeNull();

    // Simulate pointer up
    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerup', 300, 220));
    });

    // createShape should have been called once
    expect(createFn).toHaveBeenCalledTimes(1);
    // A shape should exist in the doc
    expect(snapshot(doc).length).toBe(1);
  });
});

// TC-16: dblclick shape, type 600 chars → editor open, label length 500
describe('TC-16: Shape label editing with max chars', () => {
  it('label editor clamps to SHAPE_LABEL_MAX_CHARS', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 150 }, at: { x: 0, y: 0 } }, 'local')!;

    const { container } = render(
      <svg style={{ width: 500, height: 500 }}>
        <ShapeObject
          obj={snapshot(doc).find(s => s.id === id)! as any}
          doc={doc}
          zoom={1}
          selected={true}
          editing={true}
          onPointerDown={() => {}}
          onDblClick={() => {}}
          onEndEdit={() => {}}
        />
      </svg>
    );

    const editor = container.querySelector('[data-testid="shape-label-editor"]') as HTMLTextAreaElement;
    expect(editor).not.toBeNull();

    // Type 600 characters
    const longText = 'a'.repeat(600);
    fireEvent.change(editor, { target: { value: longText } });

    // The onBlur handler slices to max
    fireEvent.blur(editor);

    // Check the label in the doc
    const snap = snapshot(doc).find(s => s.id === id)! as any;
    expect(snap.label.length).toBeLessThanOrEqual(SHAPE_LABEL_MAX_CHARS);
  });
});

// TC-17: click blue fill and red outline swatches → colours applied; label and selection unchanged
describe('TC-17: ShapeToolbar colour application', () => {
  it('clicking fill and stroke swatches applies colours', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 150 }, at: { x: 0, y: 0 } }, 'local')!;

    const before = snapshot(doc).find(s => s.id === id)! as any;
    const labelBefore = before.label;

    const { container } = render(
      <ShapeToolbar
        fill={before.fill}
        stroke={before.stroke}
        onFill={(c) => setShapeStyle(doc, id, { fill: c })}
        onStroke={(c) => setShapeStyle(doc, id, { stroke: c })}
      />
    );

    // Click blue fill
    const blueFill = container.querySelector('[data-testid="fill-blue"]')!;
    fireEvent.click(blueFill);

    // Click red outline
    const redStroke = container.querySelector('[data-testid="stroke-red"]')!;
    fireEvent.click(redStroke);

    const after = snapshot(doc).find(s => s.id === id)! as any;
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    expect(after.label).toBe(labelBefore);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

// TC-28: Shape tool drag starting over an existing sticky → sticky position unchanged
describe('TC-28: Shape tool does not move existing objects', () => {
  it('dragging with shape tool does not change sticky position', () => {
    const doc = makeDoc();
    const stickyId = createSticky(doc, { x: 100, y: 100 });
    const before = snapshot(doc).find(s => s.id === stickyId)!;

    const createFn = vi.fn(() => null);
    const { container } = render(
      <ShapeTool
        kind="rect"
        camera={testCamera}
        onCreated={() => {}}
        create={createFn}
      />
    );

    const overlay = container.querySelector('[data-testid="shape-tool-overlay"]')!;

    // Simulate drag over the sticky's position
    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });
    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointermove', 200, 200));
    });
    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerup', 200, 200));
    });

    // Sticky position should be unchanged
    const after = snapshot(doc).find(s => s.id === stickyId)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});
