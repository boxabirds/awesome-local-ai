/**
 * Test-only object type `testbox` (story 7): resizable, not aspect-locked, minSize 10. Proves
 * that selection, move, resize and delete are generic before stories 9–12 add real types.
 * Importing this module registers the type; production code never imports it.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { boundsHitTest, registerObjectType, type ObjectProps } from '../../src/client/objects/registry';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

function TestBox({ object, selected, dragging, stackIndex, onPointerDown }: ObjectProps) {
  return (
    <div
      role="group"
      aria-label="Test box"
      data-id={object.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      style={{
        position: 'absolute',
        transform: `translate(${object.x}px, ${object.y}px)`,
        width: object.width,
        height: object.height,
        zIndex: stackIndex,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e, object.id);
      }}
    />
  );
}

registerObjectType(TESTBOX_TYPE, {
  Component: TestBox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: boundsHitTest,
});

let counter = 0;

/** Adds a testbox with an explicit rect on top of the board; returns its id. */
export function createTestBox(doc: Y.Doc, rect: Rect, z = 1): string {
  counter += 1;
  const id = `testbox-${counter}`;
  doc.transact(() => {
    const box = new Y.Map<unknown>();
    doc.getMap('objects').set(id, box);
    box.set('type', TESTBOX_TYPE);
    box.set('x', rect.x);
    box.set('y', rect.y);
    box.set('width', rect.width);
    box.set('height', rect.height);
    box.set('z', z);
    box.set('createdAt', counter);
  }, LOCAL_ORIGIN);
  return id;
}
