/**
 * A second object type that exists only for tests (story 7, task 14).
 *
 * Selection, marquee, move, resize and delete are supposed to be generic —
 * written once against the registry, not per object type (`sel.all_types`). A
 * board with nothing but sticky notes cannot prove that, so this fixture adds a
 * type with *different* answers to the three questions the gesture code asks:
 * resizable but not aspect-locked, a minimum size of its own, and no text to
 * edit. If the tests pass with it, the code really is generic.
 *
 * It is never registered by the client itself: only a test that imports this file
 * puts it into the registry.
 */
import * as Y from 'yjs';
import {
  getObjectType,
  hitTestBounds,
  registerObjectType,
  type ObjectComponentProps,
  type ObjectTypeSpec,
} from '../../src/client/objects/registry';
import { objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';

export const TESTBOX_TYPE = 'testbox';

/** Test-only type: resizable, free-form (no aspect lock), no text. */
export const testboxObjectType: ObjectTypeSpec = {
  resizable: true,
  aspectLocked: false,
  editableText: false,
  minSize: 10,
  hitTest: hitTestBounds,
  Component: function TestBox(props: ObjectComponentProps) {
    const { snapshot, selection, onObjectPointerDown } = props;
    const bounds = objectBounds(snapshot);
    return (
      <div
        className="testbox"
        data-object-body=""
        data-testbox-id={snapshot.id}
        data-selected={selection.selected ? 'true' : 'false'}
        data-dragging={selection.dragging ? 'true' : 'false'}
        role="group"
        aria-label="Test box"
        style={{
          position: 'absolute',
          left: `${bounds.x}px`,
          top: `${bounds.y}px`,
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
          background: '#d8def0',
          border: '1px solid #7b88ad',
          boxSizing: 'border-box',
          pointerEvents: 'auto',
        }}
        onPointerDown={(event) => onObjectPointerDown(event, snapshot)}
      />
    );
  },
};

/** Put the type in the registry (idempotent, so several test files may call it). */
export function registerTestbox(): void {
  if (getObjectType(TESTBOX_TYPE) == null) {
    registerObjectType(TESTBOX_TYPE, testboxObjectType);
  }
}

/** Add a test box to a board document. */
export function createTestbox(
  doc: Y.Doc,
  options: { id: string; x: number; y: number; width: number; height: number },
): ObjectSnapshot {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const map = new Y.Map<unknown>();
  map.set('type', TESTBOX_TYPE);
  map.set('x', options.x);
  map.set('y', options.y);
  map.set('width', options.width);
  map.set('height', options.height);
  map.set('z', objects.size + 1);
  map.set('createdAt', objects.size);
  doc.transact(() => {
    objects.set(options.id, map);
  });
  return {
    id: options.id,
    type: TESTBOX_TYPE,
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    z: objects.size,
    createdAt: objects.size,
  };
}

/**
 * The board as the generic code wants it.
 *
 * `snapshot()` in the shared model returns sticky notes only, which is what the
 * app renders; a fixture type needs its own view of the same document.
 */
export function testboxSnapshot(doc: Y.Doc): ObjectSnapshot[] {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const out: ObjectSnapshot[] = [];
  for (const [id, map] of objects) {
    const type = map.get('type');
    if (typeof type !== 'string') continue;
    out.push({
      id,
      type,
      x: Number(map.get('x') ?? 0),
      y: Number(map.get('y') ?? 0),
      width: Number(map.get('width') ?? 200),
      height: Number(map.get('height') ?? 200),
      z: Number(map.get('z') ?? 0),
      createdAt: Number(map.get('createdAt') ?? 0),
    });
  }
  return out.sort((a, b) => a.z - b.z);
}
