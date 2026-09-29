// Test object type for component tests (story 7, TC-24).
//
// Registered in the client object registry at module load. A minimal square
// (resizable, NOT aspect-locked, small minSize) so the resize gesture can be
// exercised against a type whose bounds come from explicit width/height
// fields, with the ratio free to change.

import type { JSX } from 'react';
import { getObjectType, registerObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { initDoc } from '../../src/shared/board-model';
import * as Y from 'yjs';

function TestBox({ obj, selected, onObjectPointerDown }: ObjectProps): JSX.Element {
  return (
    <div
      data-testid="testbox"
      data-id={obj.id}
      data-selected={selected || undefined}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width ?? 100,
        height: obj.height ?? 50,
        background: '#e5e7eb',
        border: '1px dashed #6b7280',
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
    />
  );
}

let registered = false;
export function ensureTestBoxRegistered(): void {
  if (registered) return;
  if (getObjectType('testbox') !== undefined) {
    registered = true;
    return;
  }
  registerObjectType('testbox', {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: () => false,
  });
  registered = true;
}
ensureTestBoxRegistered();

/** Insert a testbox object with explicit bounds into a doc; returns its id. */
export function addTestBox(doc: Y.Doc, x: number, y: number, width = 100, height = 50): string {
  initDoc(doc);
  const id = crypto.randomUUID();
  const m = new Y.Map();
  m.set('type', 'testbox');
  m.set('x', x);
  m.set('y', y);
  m.set('width', width);
  m.set('height', height);
  m.set('z', 1);
  m.set('createdAt', Date.now());
  doc.getMap('objects').set(id, m);
  return id;
}
