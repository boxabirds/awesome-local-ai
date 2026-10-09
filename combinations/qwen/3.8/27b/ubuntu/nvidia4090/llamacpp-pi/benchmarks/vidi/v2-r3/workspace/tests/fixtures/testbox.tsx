import type { ReactElement } from 'react';
import * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';
import {
  getObjectType,
  registerObjectType,
  type ObjectProps,
} from '../../src/client/objects/registry';

/**
 * Test-only object type (sel.registry / sel.all_types): a plain resizable box
 * that is NOT aspect-locked and has a small min size. It proves the generic
 * behaviour (selection, move, resize, delete) that is independent of the
 * sticky note. Imported only by tests; registration also marks the type as
 * known to the shared board model.
 */
export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

export function TestBox(props: ObjectProps): ReactElement {
  const { obj, zoom } = props;
  const width = obj.width ?? 100;
  const height = obj.height ?? 100;
  const labelPx = Math.max(8, 12 / zoom);
  return (
    <div
      data-object-id={obj.id}
      data-testbox="true"
      {...(props.selected ? { 'data-selected': 'true' } : {})}
      onPointerDown={(e) => {
        e.stopPropagation();
        props.onObjectPointerDown(e, obj.id);
      }}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        background: 'rgba(120, 90, 200, 0.85)',
        borderRadius: 2,
        outline: props.selected ? '2px solid #1a73e8' : 'none',
        outlineOffset: 1,
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ fontSize: labelPx, color: '#fff', opacity: 0.7, pointerEvents: 'none' }}>
        box
      </span>
    </div>
  );
}

/** Idempotent registration: importing the fixture registers the type once. */
export function registerTestBox(): void {
  if (getObjectType(TESTBOX_TYPE)) return;
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: (obj: ObjectSnapshot, p: Point) => {
      const b = objectBounds(obj);
      return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    },
  });
}

/** Create a testbox object in a board doc (mirrors createSticky's shape). */
export function createTestbox(
  doc: Y.Doc,
  at: { x: number; y: number; width?: number; height?: number },
): string {
  const objects = doc.getMap('objects') as Y.Map<Y.Map<any>>;
  let maxZ = 0;
  objects.forEach((item) => {
    const z = (item.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });
  const id = crypto.randomUUID();
  const item = new Y.Map<any>();
  item.set('type', TESTBOX_TYPE);
  item.set('x', at.x);
  item.set('y', at.y);
  if (typeof at.width === 'number') item.set('width', at.width);
  if (typeof at.height === 'number') item.set('height', at.height);
  item.set('z', maxZ + 1);
  item.set('createdAt', Date.now());
  doc.transact(() => {
    objects.set(id, item);
  });
  return id;
}

registerTestBox();
