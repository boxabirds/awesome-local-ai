// A test-only object type: resizable, not aspect-locked, minimum size 10. Imported only by tests, it proves the
// selection and transform machinery is generic before stories 9-12 add real types.
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { boundsHitTest, getObjectType, registerObjectType, type ObjectProps } from '../../src/client/objects/registry';

export const TESTBOX_MIN_SIZE = 10;

function Testbox(props: ObjectProps) {
  const { object } = props;
  return (
    <div
      role="group"
      aria-label="Test box"
      data-object-id={object.id}
      data-selected={props.selected}
      style={{ position: 'absolute', left: object.x, top: object.y, width: object.width, height: object.height, zIndex: props.stackIndex }}
      onPointerDown={(e) => {
        e.stopPropagation();
        props.onObjectPointerDown(e, object.id);
      }}
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

let counter = 0;

/** Adds a testbox with the given world rect on top of everything; returns its id. */
export function createTestbox(doc: Y.Doc, r: Rect, z = 1000 + counter): string {
  const id = `testbox-${++counter}`;
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'testbox');
    obj.set('x', r.x);
    obj.set('y', r.y);
    obj.set('width', r.width);
    obj.set('height', r.height);
    obj.set('z', z);
    doc.getMap('objects').set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}
