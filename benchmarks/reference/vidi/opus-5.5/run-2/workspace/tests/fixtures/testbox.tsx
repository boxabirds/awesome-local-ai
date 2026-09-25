/**
 * Test-only object type (design Fixtures): resizable, not aspect-locked, minSize 10.
 * Imported only by tests; proves the selection machinery is generic before stories 9–12
 * add real types. `addTestbox` writes one straight into the document.
 */
import * as Y from 'yjs';
import { boundsHitTest, getObjectType, registerObjectType, type ObjectProps } from '../../src/client/objects/registry';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

function Testbox(props: ObjectProps): React.JSX.Element {
  const { object: o } = props;
  return (
    <div
      role="group"
      aria-label="Test box"
      data-id={o.id}
      data-selected={props.selected ? 'true' : 'false'}
      data-state={props.transforming ? 'dragging' : props.selected ? 'selected' : 'unselected'}
      style={{ position: 'absolute', left: `${o.x}px`, top: `${o.y}px`, width: `${o.width}px`, height: `${o.height}px`, zIndex: o.z }}
      onPointerDown={(e) => props.onPointerDown(e, o.id)}
    />
  );
}

if (getObjectType(TESTBOX_TYPE) === undefined) {
  registerObjectType(TESTBOX_TYPE, {
    Component: Testbox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: boundsHitTest,
  });
}

let next = 0;

/** Adds a testbox with the given rect; returns its id. */
export function addTestbox(doc: Y.Doc, rect: { x: number; y: number; width: number; height: number }): string {
  next += 1;
  const id = `testbox-${next}`;
  const map = doc.getMap<Y.Map<unknown>>('objects');
  let maxZ = 0;
  map.forEach((o) => {
    maxZ = Math.max(maxZ, Number(o.get('z') ?? 0));
  });
  doc.transact(() => {
    const box = new Y.Map<unknown>();
    map.set(id, box);
    box.set('type', TESTBOX_TYPE);
    box.set('x', rect.x);
    box.set('y', rect.y);
    box.set('width', rect.width);
    box.set('height', rect.height);
    box.set('z', maxZ + 1);
    box.set('createdAt', Date.now());
  });
  return id;
}
