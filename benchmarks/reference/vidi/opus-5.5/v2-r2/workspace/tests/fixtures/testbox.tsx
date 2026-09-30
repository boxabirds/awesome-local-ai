// Test-only object type (imported only by tests): resizable, not aspect-locked,
// minimum size 10. Proves that selection and transforms are generic.
import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectsMap } from '../../src/shared/board-model';
import { boundsHitTest, getObjectType, registerObjectType } from '../../src/client/objects/registry';
import type { ObjectProps } from '../../src/client/objects/types';

export const TESTBOX_MIN_SIZE = 10;

function TestBox(props: ObjectProps): React.JSX.Element {
  const { object } = props;
  return (
    <div
      role="group"
      aria-label="Test box"
      data-testbox=""
      data-id={object.id}
      data-selected={props.selected ? 'true' : 'false'}
      style={{ position: 'absolute', left: object.x, top: object.y, width: object.width, height: object.height, zIndex: object.z }}
      onPointerDown={(e) => {
        e.stopPropagation();
        props.onPointerDown(e, object.id);
      }}
    />
  );
}

if (!getObjectType('testbox')) {
  registerObjectType('testbox', {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: boundsHitTest,
  });
}

/** Adds a testbox object directly to the document. */
export function createTestBox(doc: Y.Doc, rect: { x: number; y: number; width: number; height: number }, z = 1): string {
  const id = `box-${crypto.randomUUID()}`;
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'testbox');
    m.set('x', rect.x);
    m.set('y', rect.y);
    m.set('width', rect.width);
    m.set('height', rect.height);
    m.set('z', z);
    m.set('createdAt', 0);
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}
