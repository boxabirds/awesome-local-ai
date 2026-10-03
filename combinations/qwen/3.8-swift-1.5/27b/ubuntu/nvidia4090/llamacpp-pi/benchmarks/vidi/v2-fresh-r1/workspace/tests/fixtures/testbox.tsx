// Test fixture: a minimal non-sticky object type registered with the
// object registry (story 7 TC-24/TC-27). It is resizable without a locked
// aspect ratio and has no text editing. Imported only from tests.

import type { PointerEvent as ReactPointerEvent } from 'react';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';
import { rectContains, type Point } from '../../src/shared/geometry';

function TestBox({ obj, selected, onObjectPointerDown, onObjectDoubleClick }: ObjectProps) {
  const width = obj.width ?? 100;
  const height = obj.height ?? 50;
  return (
    <div
      data-testid="testbox"
      data-selected={selected || undefined}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
      onDoubleClick={() => onObjectDoubleClick?.(obj.id)}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        backgroundColor: '#E1F5FE',
        border: '1px solid #0288D1',
        borderRadius: '2px',
        pointerEvents: 'auto',
        boxSizing: 'border-box',
      }}
    />
  );
}

registerObjectType('testbox', {
  Component: TestBox,
  resizable: true,
  aspectLocked: false,
  minSize: 10,
  editableText: false,
  hitTest: (obj, p: Point) => {
    const r = objectBounds(obj);
    return rectContains(r, { x: p.x, y: p.y, width: 0, height: 0 });
  },
});

export type { ReactPointerEvent };
