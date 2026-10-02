import React from 'react';
import * as Y from 'yjs';
import { registerObjectType, pointInBounds } from '../../src/client/objects/registry';
import type { ObjectProps } from '../../src/client/objects/registry';
import { getObjectsMap } from '../../src/shared/board-model';
import type { Point } from '../../src/shared/geometry';

/** Test-only object type: exercises the generic path of stories 5 and 7. */
export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_DEFAULT_SIZE = { width: 160, height: 90 };

/**
 * A plain rectangle. It has no text, no colour and no ratio of its own, so a
 * group resize shows that sizing rules are asked of the object type instead of
 * being guessed by the board.
 */
function TestBox({ obj, selected, soleSelected, transforming, onObjectPointerDown }: ObjectProps) {
  return (
    <div
      data-testid="testbox"
      data-note-id={obj.id}
      data-z={obj.z}
      data-selected={selected ? 'true' : 'false'}
      data-transforming={transforming ? 'true' : 'false'}
      data-sole={soleSelected ? 'true' : 'false'}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        backgroundColor: '#cfe3ff',
        border: '1px solid #456',
        boxSizing: 'border-box',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {`box:${obj.z}`}
    </div>
  );
}

let registered = false;

/** Register the fixture once per module instance; later calls are ignored. */
export function registerTestbox(): void {
  if (registered) return;
  registered = true;
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: 22.5,
    editableText: false,
    hitTest: pointInBounds,
  });
}

function nextZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of getObjectsMap(doc).values()) {
    const z = m.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max + 1;
}

/**
 * Insert a testbox straight into the document. `at` is the top-left, which is
 * what the snapshot stores, so tests read the coordinates back unchanged.
 */
export function createTestbox(
  doc: Y.Doc,
  at: Point,
  size: { width: number; height: number } = TESTBOX_DEFAULT_SIZE,
): string {
  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', TESTBOX_TYPE);
    m.set('x', at.x);
    m.set('y', at.y);
    m.set('width', size.width);
    m.set('height', size.height);
    m.set('z', nextZ(doc));
    m.set('createdAt', Date.now());
    getObjectsMap(doc).set(id, m);
  });
  return id;
}
