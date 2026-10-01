import * as Y from 'yjs';
import { boundsHitTest, registerObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';

export const TESTBOX_MIN_SIZE = 10;

function Testbox(props: ObjectProps) {
  const o = props.object;
  return (
    <div
      role="group"
      aria-label="Test box"
      data-object-id={o.id}
      data-selected={props.selected ? 'true' : 'false'}
      onPointerDown={(e) => {
        e.stopPropagation();
        props.onObjectPointerDown(e, o.id);
      }}
      style={{ position: 'absolute', left: o.x, top: o.y, width: o.width, height: o.height, zIndex: o.z, background: '#9cf' }}
    />
  );
}

let registered = false;

/** Registers the test-only resizable, not aspect-locked `testbox` type (idempotent; imported only by tests). */
export function registerTestbox(): void {
  if (registered) return;
  registered = true;
  registerObjectType('testbox', {
    Component: Testbox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: boundsHitTest,
  });
}

export function addTestbox(doc: Y.Doc, rect: Rect, z = 100): string {
  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).set(id, m);
    m.set('type', 'testbox');
    m.set('x', rect.x);
    m.set('y', rect.y);
    m.set('width', rect.width);
    m.set('height', rect.height);
    m.set('z', z);
    m.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}
