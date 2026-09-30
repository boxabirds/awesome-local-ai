/**
 * Test-only board-object type (story 7, sel.registry): resizable, NOT
 * aspect-locked, minSize 10. Imported only by tests — it exercises the
 * non-sticky branch of the selection/resize machinery (free 2-axis resize).
 */
import * as Y from 'yjs';
import { registerObjectType } from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';
import type { ObjectProps } from '../../src/client/objects/registry';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

function TestBox({ obj, selected, onPointerDown }: ObjectProps) {
  const width = obj.width ?? 200;
  const height = obj.height ?? 100;
  return (
    <div
      data-testid="testbox"
      data-note-id={obj.id}
      data-selected={selected || undefined}
      onPointerDown={(e) => onPointerDown(e, obj.id)}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        background: '#e2e8f0',
        border: '1px solid #94a3b8',
        boxSizing: 'border-box',
      }}
    />
  );
}

let registered = false;

/** Idempotent: safe to call from every test in a file. */
export function registerTestBox(): void {
  if (registered) return;
  registered = true;
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: (obj, p) => {
      const b = objectBounds(obj);
      return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    },
  });
}

/** Creates a testbox directly in the doc (bypasses createSticky). */
export function createTestBox(doc: Y.Doc, x: number, y: number, width = 200, height = 100): string {
  const map = doc.getMap('objects');
  const id = `testbox-${Math.random().toString(36).slice(2, 10)}`;
  let maxZ = 0;
  map.forEach((m) => {
    const z = (m as import('yjs').Map<unknown>).get('z');
    if (typeof z === 'number' && z > maxZ) maxZ = z;
  });
  const obj = new Y.Map();
  obj.set('type', TESTBOX_TYPE);
  obj.set('x', x);
  obj.set('y', y);
  obj.set('width', width);
  obj.set('height', height);
  obj.set('z', maxZ + 1);
  map.set(id, obj);
  return id;
}
