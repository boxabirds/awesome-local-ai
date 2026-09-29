// A test-only object type (design "Fixtures": a registered, non-aspect-locked
// type with minSize 10). It exists so the tests can prove that selecting,
// moving, resizing and deleting are generic over the registry instead of
// hard-coded to sticky notes — the promise stories 9-12 rely on.
//
// Imported only by tests; it registers itself once, at import time.

import type * as Y from 'yjs';
import { createObject, objectBounds } from '../../src/shared/board-model.ts';
import {
  registerObjectType,
  hitTestRect,
  type ObjectProps,
} from '../../src/client/objects/registry.tsx';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

/**
 * A plain rectangle: no text editor (`editableText: false`), free-form resize
 * (`aspectLocked: false`), and the same delegated pointer-down a real type uses.
 */
export function TestBox(props: ObjectProps) {
  const { obj, selected } = props;
  const r = objectBounds(obj);
  return (
    <div
      data-testid="testbox"
      data-object-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Test box"
      tabIndex={0}
      onPointerDown={(e) => props.onObjectPointerDown(e, obj.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        props.onObjectDoubleClick(e, obj.id);
      }}
      style={{
        position: 'absolute',
        left: r.x,
        top: r.y,
        width: r.width,
        height: r.height,
        boxSizing: 'border-box',
        border: '2px solid #7a5cf0',
        background: 'rgba(122,92,240,0.12)',
        zIndex: obj.z,
        pointerEvents: 'auto',
        cursor: 'grab',
        outline: selected ? '2px solid #2f6fed' : 'none',
      }}
    />
  );
}

/** Write a testbox straight into the document (a test's "creator"). */
export function createTestBox(
  doc: Y.Doc,
  x: number,
  y: number,
  width = 200,
  height = 120,
): string {
  // `createObject` is the generic creator board-model offers for the types that
  // later stories add; a real story would wrap it in its own typed creator.
  return createObject(doc, TESTBOX_TYPE, { x, y }, { width, height });
}

registerObjectType(TESTBOX_TYPE, {
  Component: TestBox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: hitTestRect,
});

/**
 * A second test-only type, registered with `resizable: false`: the way to prove
 * the selection overlay asks the registry instead of assuming every object can be
 * resized. Later object types that cannot be resized (a connector, say) behave the
 * same way.
 */
export const TESTFIXED_TYPE = 'testfixed';

export function createFixedBox(doc: Y.Doc, x: number, y: number, width = 200, height = 120): string {
  return createObject(doc, TESTFIXED_TYPE, { x, y }, { width, height });
}

registerObjectType(TESTFIXED_TYPE, {
  Component: TestBox,
  resizable: false,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest: hitTestRect,
});
