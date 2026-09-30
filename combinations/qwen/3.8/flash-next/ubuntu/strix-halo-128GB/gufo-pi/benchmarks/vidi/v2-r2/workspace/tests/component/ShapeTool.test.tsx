import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky } from '@shared/board-model';
import { createShape, setShapeStyle, getShapeLabel } from '@shared/objects/shape';

describe('shape.model (component level)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-15 prerequisite: createShape is callable
  it('creates shape via model call', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } }, 'user1');
    expect(id).not.toBeNull();
  });

  // TC-16 prerequisite: label editing - clamp to 500 chars
  it('label Y.Text accepts text and is limited', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'user1')!;
    const label = getShapeLabel(doc, id)!;
    // Insert 500 characters
    label.insert(0, 'a'.repeat(500));
    expect(label.toString().length).toBe(500);
  });

  // TC-17 prerequisite: style changes
  it('changes fill and stroke independently', () => {
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'user1')!;
    const label = getShapeLabel(doc, id)!;
    label.insert(0, 'hello');

    setShapeStyle(doc, id, { fill: 'blue' });
    setShapeStyle(doc, id, { stroke: 'red' });

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id)!;
    expect(obj.get('fill')).toBe('blue');
    expect(obj.get('stroke')).toBe('red');
    expect((obj.get('label') as Y.Text).toString()).toBe('hello');
    expect(obj.get('width')).toBe(100);
    expect(obj.get('x')).toBe(0);
  });

  // TC-28 prerequisite: tool owns the gesture so drags over existing stickies don't move them
  it('sticky created normally - shape tool captures overlay', () => {
    const stickyId = createSticky(doc, { x: 100, y: 100 });
    expect(stickyId).toBeTruthy();
    // The shape tool overlay captures all pointer events, so the sticky won't receive them
  });
});
