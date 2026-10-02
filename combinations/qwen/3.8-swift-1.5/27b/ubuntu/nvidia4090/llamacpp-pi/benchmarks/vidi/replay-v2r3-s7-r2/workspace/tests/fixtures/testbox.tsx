/**
 * Test-only object type: a plain box (story 7 fixture).
 *
 * Registered in test builds to prove the generic selection/transform machinery
 * before stories 9–12 add real types: resizable, NOT aspect-locked, minSize 10.
 * Imported only by tests.
 */

import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { registerObjectType } from '../../src/client/objects/registry';
import type { ObjectProps } from '../../src/client/objects/registry';
import { objectBounds, initDoc } from '../../src/shared/board-model';
import { registerObjectTypeKey } from '../../src/shared/object-types';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

function TestBox({ obj, selected, onPointerDown }: ObjectProps): React.ReactElement {
  const b = objectBounds(obj);
  const ref = useRef<HTMLDivElement>(null);
  const onPointerDownRef = useRef(onPointerDown);
  onPointerDownRef.current = onPointerDown;
  const id = obj.id;

  // Delegate pointerdown to the board's transform gesture (like StickyNote).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onPointerDownRef.current(e, id);
    };
    el.addEventListener('pointerdown', handler);
    return () => el.removeEventListener('pointerdown', handler);
  }, [id]);

  return (
    <div
      ref={ref}
      data-testid={`testbox-${obj.id}`}
      data-selected={selected || undefined}
      style={{
        touchAction: 'none',
        position: 'absolute',
        left: b.x,
        top: b.y,
        width: b.width,
        height: b.height,
        background: '#E3F2FD',
        border: '1px solid #90A4AE',
        boxSizing: 'border-box',
      }}
    />
  );
}

// Known to the shared board model so snapshot() includes it.
registerObjectTypeKey(TESTBOX_TYPE);

registerObjectType(TESTBOX_TYPE, {
  Component: TestBox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  },
});

/** Create a testbox at world `at` (centre) with the given size. Returns the id. */
export function createTestbox(
  doc: Y.Doc,
  at: { x: number; y: number },
  size: { width: number; height: number } = { width: 100, height: 50 },
): string {
  initDoc(doc);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const objects = doc.getMap('objects');
    let z = 0;
    for (const m of objects.values()) {
      const mz = (m as Y.Map<unknown>).get('z');
      if (typeof mz === 'number' && mz > z) z = mz;
    }
    const m = new Y.Map<unknown>();
    m.set('type', TESTBOX_TYPE);
    m.set('x', at.x - size.width / 2);
    m.set('y', at.y - size.height / 2);
    m.set('width', size.width);
    m.set('height', size.height);
    m.set('z', z + 1);
    m.set('createdAt', Date.now());
    objects.set(id, m);
  });
  return id;
}
