// A test-only object type (design "Fixtures": a registered, resizable,
// NOT aspect-locked type with minSize 10). Importing this file registers it, so
// the component tests can prove the selection / transform machinery is generic —
// the behaviour is not sticky-specific — before stories 9–12 add real types.
//
// It is imported by tests only; nothing in src/ knows it exists.

import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  declareObjectType as declareModelObjectType,
  objectBounds,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { declareObjectType, type ObjectProps } from '../../src/client/objects/registry';
import type { Rect } from '../../src/shared/geometry';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

/** A plain resizable box: no text, no aspect lock — the shape a Figma-ish
 * rectangle from story 10 will have. */
export function TestBox({ obj, selected, onObjectPointerDown }: ObjectProps) {
  const b = objectBounds(obj);
  return (
    <div
      data-testid="test-box"
      data-obj-id={obj.id}
      data-obj-type={obj.type}
      data-selected={selected ? 'true' : 'false'}
      data-width={Math.round(b.width)}
      data-height={Math.round(b.height)}
      onPointerDown={(e) => {
        e.stopPropagation();
        // Selects on a read-only board too; the gesture is what refuses to write.
        onObjectPointerDown(e, obj.id);
      }}
      style={{
        position: 'absolute',
        left: b.x,
        top: b.y,
        width: b.width,
        height: b.height,
        border: '2px solid #0891b2',
        background: 'rgba(8,145,178,0.15)',
        pointerEvents: 'auto',
        outline: selected ? '2px solid #2563eb' : 'none',
      }}
    />
  );
}

// Registering a type is two calls: the model half makes its objects appear in
// snapshots (so they can be selected and transformed), the client half gives it a
// renderer and capabilities. This is exactly what stories 9–12 will do.
declareModelObjectType(TESTBOX_TYPE);
declareObjectType(TESTBOX_TYPE, {
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  render: (props) => <TestBox {...props} />,
});

/** Plant a testbox in a document with an exact rect and z. Returns its id. */
export function createTestbox(doc: Y.Doc, rect: Rect & { z?: number }, type: string = TESTBOX_TYPE): string {
  const id = crypto.randomUUID();
  const ymap = new Y.Map<unknown>();
  ymap.set('type', type);
  ymap.set('x', rect.x);
  ymap.set('y', rect.y);
  ymap.set('width', rect.width);
  ymap.set('height', rect.height);
  ymap.set('z', rect.z ?? 1);
  ymap.set('createdAt', 1);
  doc.transact(() => {
    doc.getMap<Y.Map<unknown>>('objects').set(id, ymap);
  }, LOCAL_ORIGIN);
  return id;
}

/** A snapshot row for an arbitrary type (unit tests that need a row the model
 * itself would not produce). */
export function testboxRow(id: string, rect: Rect): ObjectSnapshot {
  return { id, type: TESTBOX_TYPE, x: rect.x, y: rect.y, width: rect.width, height: rect.height, z: 1, createdAt: 1 };
}
