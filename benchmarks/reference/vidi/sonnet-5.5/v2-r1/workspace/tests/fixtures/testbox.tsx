import * as Y from 'yjs';
import { boundsHitTest, registerObjectType } from '../../src/client/objects/registry';
import type { ObjectProps } from '../../src/client/objects/registry';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';

export const TESTBOX_MIN_SIZE = 10;

function Testbox(props: ObjectProps) {
  const { object } = props;
  return (
    <div
      data-testbox-id={object.id}
      data-selected={props.selected ? 'true' : 'false'}
      style={{ position: 'absolute', left: object.x, top: object.y, width: object.width, height: object.height, zIndex: object.z }}
      onPointerDown={(e) => {
        e.stopPropagation();
        props.onObjectPointerDown(e, object.id);
      }}
    />
  );
}

/** Test-only object type: resizable, not aspect locked, minimum size 10. Imported only by tests. */
registerObjectType('testbox', {
  Component: Testbox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: boundsHitTest,
});

export function addTestbox(doc: Y.Doc, x: number, y: number, width: number, height: number): string {
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).set(id, obj);
    obj.set('type', 'testbox');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('z', 1);
    obj.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}
