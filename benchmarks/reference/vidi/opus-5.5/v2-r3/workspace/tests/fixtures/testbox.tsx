// Test-only object type (story 7 fixtures): resizable, NOT aspect-locked,
// minSize 10. Proves selection, move and resize are generic before stories
// 9–12 add real types. Imported only by tests.
import * as Y from 'yjs';
import { getObjectsMap, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { boundsHitTest, getObjectType, registerObjectType, type ObjectProps } from '../../src/client/objects/registry';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

function TestBox(props: ObjectProps) {
  const { object } = props;
  return (
    <div
      className="board-object"
      role="group"
      aria-label="Test box"
      data-object-id={object.id}
      data-selected={props.selected ? 'true' : 'false'}
      data-state={props.gesture}
      style={{ position: 'absolute', left: object.x, top: object.y, width: object.width, height: object.height, zIndex: props.zIndex }}
      onPointerDown={(e) => {
        e.stopPropagation();
        props.onPointerDown(e, object.id);
      }}
    />
  );
}

/** Registers the testbox type once per module graph. */
export function registerTestBox(): void {
  if (getObjectType(TESTBOX_TYPE)) return;
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: boundsHitTest,
  });
}

/** Adds a testbox with the given rect to the doc; returns its id. */
export function createTestBox(doc: Y.Doc, rect: { x: number; y: number; width: number; height: number }): string {
  const id = `box-${crypto.randomUUID()}`;
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', TESTBOX_TYPE);
    m.set('x', rect.x);
    m.set('y', rect.y);
    m.set('width', rect.width);
    m.set('height', rect.height);
    let z = 0;
    getObjectsMap(doc).forEach((o) => {
      const oz = o.get('z');
      if (typeof oz === 'number') z = Math.max(z, oz);
    });
    m.set('z', z + 1);
    m.set('createdAt', Date.now());
    getObjectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}
