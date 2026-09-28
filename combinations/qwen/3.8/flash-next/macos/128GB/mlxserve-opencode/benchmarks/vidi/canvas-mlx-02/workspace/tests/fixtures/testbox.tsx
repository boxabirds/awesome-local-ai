// A test-only board object type (design Fixtures): resizable, NOT aspect-locked,
// minimum size 10. Importing this file registers it — in the client registry and
// in the board model's readable set — so component tests can prove the generic
// selection / transform machinery works for a type that is not a sticky note,
// before stories 9-12 add real ones. Never imported by production code.
import type React from 'react';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry.tsx';

export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

export const DEFAULT_TESTBOX_SIZE = 100;

function TestBox(props: ObjectProps): React.JSX.Element {
  const { obj, zoom, selected, editable, onObjectPointerDown } = props;
  const w = obj.width ?? DEFAULT_TESTBOX_SIZE;
  const h = obj.height ?? DEFAULT_TESTBOX_SIZE;
  return (
    <div
      role="group"
      aria-label="Test box"
      data-testid={`testbox-${obj.id}`}
      data-object-id={obj.id}
      data-selected={selected}
      data-editable={editable}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: w,
        height: h,
        background: '#d9d9d9',
        border: '1px solid #9e9e9e',
        boxSizing: 'border-box',
        outline: selected ? '2px solid #2563eb' : 'none',
        pointerEvents: 'auto',
        touchAction: 'none',
        // Toolbar/badges drawn by the overlay keep a constant screen size.
        ['--zoom' as string]: zoom,
        ['--editable' as string]: String(editable),
      }}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
    />
  );
}

export function registerTestBox(): void {
  registerObjectType(TESTBOX_TYPE, {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest(obj, point) {
      const x = obj.x;
      const y = obj.y;
      const w = obj.width ?? DEFAULT_TESTBOX_SIZE;
      const h = obj.height ?? DEFAULT_TESTBOX_SIZE;
      return point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
    },
  });
}

registerTestBox();
