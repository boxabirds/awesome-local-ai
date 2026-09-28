/**
 * Story 7 test fixture: a test-only board object type `testbox` registered
 * in test builds to prove the selection/move/resize machinery is generic —
 * it is resizable but NOT aspect-locked (unlike sticky), so edge handles
 * change one axis only, and it has a small minimum size (10 world units).
 *
 * Importing this module registers the type (module-level side effect);
 * `registerTestBox()` throws on double registration (see registry tests).
 */
import type { JSX } from 'react';
import type { ObjectProps } from 'src/client/objects/registry';
import { registerObjectType } from 'src/client/objects/registry';
import { objectBounds } from 'src/shared/board-model';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

export function TestBox(props: ObjectProps): JSX.Element {
  const { obj, selected } = props;
  const width = obj.width ?? 100;
  const height = obj.height ?? 60;
  return (
    <div
      data-testid="testbox"
      data-note-id={obj.id}
      data-selected={selected || undefined}
      aria-label="Test box"
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        backgroundColor: '#B3E5FC',
        border: '1px solid #0288D1',
        borderRadius: 4,
        outline: selected ? '2px solid #1A73E8' : 'none',
        outlineOffset: -1,
        zIndex: obj.z,
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        props.onPointerDown(e, obj.id);
      }}
    />
  );
}

/** Registers `testbox` (throws when called twice). */
export function registerTestBox(): void {
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
}

registerTestBox();
