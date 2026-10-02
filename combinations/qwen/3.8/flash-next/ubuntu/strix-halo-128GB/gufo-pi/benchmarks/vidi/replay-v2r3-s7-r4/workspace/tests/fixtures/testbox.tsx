import React from 'react';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';

/**
 * A test-only board object type: resizable, NOT aspect-locked, minimum size 10
 * (imported only by tests) — used to prove the generic transform code works for
 * a non-square-resizable type before stories 9–12 add real object kinds.
 */
export const TESTBOX_TYPE = 'testbox';
export const TESTBOX_MIN_SIZE = 10;

function TestBox({ obj, selected, dragging, onObjectPointerDown }: ObjectProps) {
  const b = objectBounds(obj);
  return (
    <div
      data-note-id={obj.id}
      data-testid="testbox"
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: b.x,
        top: b.y,
        width: b.width,
        height: b.height,
        backgroundColor: '#b0bec5',
        border: selected ? '2px solid #1976D2' : '1px solid #607d8b',
        boxSizing: 'border-box',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onObjectPointerDown(e, obj.id);
      }}
    />
  );
}

registerObjectType(TESTBOX_TYPE, {
  Component: TestBox,
  resizable: true,
  aspectLocked: false,
  minSize: TESTBOX_MIN_SIZE,
  editableText: false,
  hitTest(o, p) {
    const b = objectBounds(o);
    return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  },
});
