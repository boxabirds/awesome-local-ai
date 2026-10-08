/** Test-only object type for component tests. Not exported from production code. */
import React, { forwardRef } from 'react';
import { registerObjectType, getObjectType } from '@client/objects/registry';
import type { ObjectTypeSpec } from '@client/objects/registry';
import type { StickySnapshot } from '@shared/board-model';
import type { Point } from '@client/canvas/camera';

export const TestBoxComponent = forwardRef<HTMLDivElement, { obj: any; selected?: boolean }>(
  function TestBoxComponent({ obj, selected }, ref) {
    return (
      <div
        ref={ref}
        data-test-box-id={obj.id}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${obj.width ?? 100}px`,
          height: `${obj.height ?? 100}px`,
          transform: `translate(${obj.x}px, ${obj.y}px)`,
          background: '#aaa',
          border: selected ? '2px solid red' : '1px solid #999',
          boxSizing: 'border-box',
        }}
      >
        TB
      </div>
    );
  },
);

// Register a test-only type so tests can use it without importing sticky's actual component
if (!getObjectType('testbox')) {
  registerObjectType('testbox', {
    Component: TestBoxComponent as any,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest(obj: StickySnapshot, pt: Point): boolean {
      const b = { x: obj.x, y: obj.y, width: (obj as any).width ?? 100, height: (obj as any).height ?? 100 };
      return (
        pt.x >= b.x &&
        pt.y >= b.y &&
        pt.x <= b.x + b.width &&
        pt.y <= b.y + b.height
      );
    },
  });
}
