import type { JSX } from 'react';
import * as Y from 'yjs';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import type { ObjectProps } from '../../src/client/objects/registry';
import { pointInRect } from '../../src/shared/geometry';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';

/**
 * A test-only board object type (story 7, task 7): resizable, NOT
 * aspect-locked, minSize 10. It exists to prove the generic selection /
 * move / resize behaviour does not depend on sticky-specific code (TC-12,
 * TC-24). Imported only by tests; registering it here is idempotent.
 */
export const TESTBOX_DEFAULT_SIZE = 100;
export const TESTBOX_MIN_SIZE = 10;

function testboxBounds(obj: ObjectSnapshot) {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? TESTBOX_DEFAULT_SIZE,
    height: obj.height ?? TESTBOX_DEFAULT_SIZE,
  };
}

/** Plain box: delegates its press to the generic transform gesture. */
export function TestBox(props: ObjectProps): JSX.Element {
  const { obj, onObjectPointerDown, selected } = props;
  const b = testboxBounds(obj);
  return (
    <div
      className="vidi6-testbox"
      data-testid="testbox"
      data-note-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: b.width,
        height: b.height,
        background: '#9E9E9E',
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onObjectPointerDown(e.nativeEvent, obj.id);
      }}
    />
  );
}

if (getObjectType('testbox') === undefined) {
  registerObjectType('testbox', {
    Component: TestBox,
    resizable: true,
    handles: 'all',
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: (obj, p: Point) => pointInRect(testboxBounds(obj), p),
  });
}

/** Highest z in the doc + 1 (the doc's own stacking rule). */
function nextZ(doc: Y.Doc): number {
  let max = 0;
  ;(doc.getMap('objects') as Y.Map<Y.Map<unknown>>).forEach((o) => {
    const z = o.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max + 1;
}

/** Create a testbox at explicit world rect (always explicit w/h). */
export function createTestbox(doc: Y.Doc, x: number, y: number, width = 100, height = 100): string {
  const id = crypto.randomUUID();
  const obj = new Y.Map();
  obj.set('type', 'testbox');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('width', width);
  obj.set('height', height);
  obj.set('z', nextZ(doc));
  obj.set('createdAt', Date.now());
  doc.transact(() => {
    doc.getMap('objects').set(id, obj);
  });
  return id;
}
