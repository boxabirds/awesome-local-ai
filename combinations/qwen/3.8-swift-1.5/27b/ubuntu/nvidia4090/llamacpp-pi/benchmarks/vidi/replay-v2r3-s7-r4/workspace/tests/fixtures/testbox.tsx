import * as Y from 'yjs';
import {
  registerObjectType,
  type ObjectProps,
} from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';

export const TESTBOX_MIN_SIZE_WORLD = 10;

/**
 * Story 7 test fixture: a test-only board object type. Resizable, NOT
 * aspect-locked, minSize 10. Registered at import (imported only by tests)
 * to prove the generic selection/transform behaviour before stories 9–12
 * add real types.
 */
export function TestBox({ obj, selected, onObjectPointerDown }: ObjectProps): React.ReactElement {
  const width = obj.width ?? 100;
  const height = obj.height ?? 100;
  return (
    <div
      data-testid={`testbox-${obj.id}`}
      data-selected={selected || undefined}
      onPointerDown={(e) => onObjectPointerDown(e.nativeEvent, obj.id)}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        zIndex: obj.z,
        background: '#E1BEE7',
        border: '2px solid #8E24AA',
        boxSizing: 'border-box',
      }}
    />
  );
}

registerObjectType('testbox', {
  Component: TestBox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  },
});

/** Highest z among all objects in `doc`, or 0 when empty. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  doc.getMap('objects').forEach((m) => {
    const z = (m as Y.Map<unknown>).get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/** Create a testbox object with explicit width/height. Returns the new id. */
export function createTestBox(doc: Y.Doc, x: number, y: number, width: number, height: number): string {
  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'testbox');
    m.set('x', x);
    m.set('y', y);
    m.set('width', width);
    m.set('height', height);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    doc.getMap('objects').set(id, m);
  });
  return id;
}
