// Test-only object type: resizable, not aspect-locked, minSize 10. Proves that selection, move,
// resize and delete are generic before stories 9–12 add real types. Imported only by tests.
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  type ObjectProps,
  boundsHitTest,
  getObjectType,
  registerObjectType,
} from '../../src/client/objects/registry';

export const TESTBOX_MIN_SIZE = 10;

function Testbox(props: ObjectProps) {
  const { object } = props;
  return (
    <div
      role="group"
      aria-label="Test box"
      data-object-id={object.id}
      data-selected={props.selected}
      style={{ position: 'absolute', left: object.x, top: object.y, width: object.width, height: object.height }}
      onPointerDown={(e) => props.onPointerDown(e, object.id)}
    />
  );
}

if (!getObjectType('testbox')) {
  registerObjectType('testbox', {
    Component: Testbox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: boundsHitTest,
  });
}

/** Adds a testbox object to the doc and returns its id. */
export function addTestbox(
  doc: Y.Doc,
  rect: { x: number; y: number; width: number; height: number },
  z = 1,
): string {
  const id = `box-${Math.random().toString(36).slice(2)}`;
  doc.transact(() => {
    const box = new Y.Map<unknown>();
    box.set('type', 'testbox');
    box.set('x', rect.x);
    box.set('y', rect.y);
    box.set('width', rect.width);
    box.set('height', rect.height);
    box.set('z', z);
    box.set('createdAt', Date.now());
    doc.getMap('objects').set(id, box);
  }, LOCAL_ORIGIN);
  return id;
}
