import * as React from 'react';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { registerBoardType } from '../../src/shared/board-model';

export const TESTBOX_MIN_SIZE = 10;

/**
 * Test-only board object type (story 7 fixture): resizable, NOT aspect-locked,
 * minimum size 10 world units. Proves the generic selection/transform
 * machinery works for non-sticky types before stories 9–12 add real ones.
 * Imported only by tests.
 */
function Testbox({ obj, selected, onPointerDown }: ObjectProps): React.ReactElement {
  const w = obj.width ?? 100;
  const h = obj.height ?? 100;
  return React.createElement('div', {
    'data-testid': `testbox-${obj.id}`,
    'data-board-object': true,
    'data-selected': selected || undefined,
    onPointerDown: (e: React.PointerEvent) => onPointerDown(e.nativeEvent, obj.id),
    style: {
      position: 'absolute',
      left: obj.x,
      top: obj.y,
      width: w,
      height: h,
      background: '#B3E5FC',
      border: '1px solid #4FC3F7',
      zIndex: obj.z,
      boxSizing: 'border-box',
    },
  });
}

let registered = false;

/** Register the `testbox` type (idempotent — safe from every test file). */
export function registerTestbox(): void {
  if (registered) return;
  registered = true;
  registerBoardType('testbox');
  registerObjectType('testbox', {
    Component: Testbox,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: (o, p) => {
      const w = o.width ?? 100;
      const h = o.height ?? 100;
      return p.x >= o.x && p.x <= o.x + w && p.y >= o.y && p.y <= o.y + h;
    },
  });
}
