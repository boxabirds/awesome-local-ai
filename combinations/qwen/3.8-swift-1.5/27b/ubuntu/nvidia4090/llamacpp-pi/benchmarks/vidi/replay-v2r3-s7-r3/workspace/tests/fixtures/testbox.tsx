import { useLayoutEffect, useRef } from 'react';
import { registerObjectType, getObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';
import * as Y from 'yjs';
import type { Point } from '../../src/client/canvas/camera';

/** Minimum size of the test-only `testbox` type (board units). */
export const TESTBOX_MIN_SIZE = 10;

/**
 * A test-only board object type: resizable, NOT aspect-locked (so the
 * non-uniform resize paths can be tested — sticky notes are locked), small
 * minimum size. Importing this module in a test registers the type.
 */
function TestBox(props: ObjectProps): React.ReactElement {
  const { obj, onPointerDown } = props;
  const width = obj.width ?? 100;
  const height = obj.height ?? 100;
  const ref = useRef<HTMLDivElement>(null);
  const onPointerDownRef = useRef(onPointerDown);
  onPointerDownRef.current = onPointerDown;

  // Native listener (like StickyNote): stopPropagation keeps the viewport's
  // pan/clear handlers from seeing pointerdowns on the object.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onPointerDownRef.current(e, obj.id);
    };
    el.addEventListener('pointerdown', handler);
    return () => el.removeEventListener('pointerdown', handler);
  }, [obj.id]);

  return (
    <div
      ref={ref}
      data-testid={`testbox-${obj.id}`}
      data-selected={props.selected || undefined}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        zIndex: obj.z,
        background: '#E3F2FD',
        border: '1px solid #1E88E5',
        boxSizing: 'border-box',
        touchAction: 'none',
      }}
    />
  );
}

let registered = false;

/** Idempotently register the `testbox` type (the registry throws on duplicates). */
export function registerTestBox(): void {
  if (registered) return;
  registered = true;
  registerObjectType('testbox', {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: (obj, p) => {
      const b = objectBounds(obj);
      return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    },
  });
}

/**
 * Create a `testbox` object in `doc` with its top-left at `at` and the given
 * size (default 120×80). Returns the new object id.
 */
export function createTestBox(
  doc: Y.Doc,
  at: Point,
  size: { width: number; height: number } = { width: 120, height: 80 },
): string {
  const objects = doc.getMap('objects');
  const id = `tb-${Math.random().toString(36).slice(2, 10)}`;
  const m = new Y.Map<unknown>();
  m.set('type', 'testbox');
  m.set('x', at.x);
  m.set('y', at.y);
  m.set('z', (objects.size > 0 ? 10_000 : 1) + objects.size);
  m.set('width', size.width);
  m.set('height', size.height);
  objects.set(id, m);
  return id;
}

export { getObjectType };
