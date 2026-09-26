import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import {
  registerKnownObjectType,
  objectBounds,
  type ObjectSnapshot,
} from '@/shared/board-model';
import { registerObjectType, getObjectType, type ObjectProps } from '@/client/objects/registry';
import type { Point } from '@/shared/geometry';

/**
 * Test-only object type (story 7, task 8): a plain resizable rectangle that
 * is NOT aspect-locked and NOT text-editable. Registered by importing this
 * module (tests only) to prove that selection/move/resize/delete behave the
 * same for every registered type (sel.all_types), not just stickies.
 *
 * The board's `allObjectIds` (select-all) only includes known types, so this
 * module also marks 'testbox' as known.
 */
registerKnownObjectType('testbox');

export const TESTBOX_DEFAULT_WIDTH = 100;
export const TESTBOX_DEFAULT_HEIGHT = 50;
export const TESTBOX_MIN_SIZE = 10;

function TestboxComponent(props: ObjectProps): ReactElement {
  const width =
    typeof props.width === 'number' && Number.isFinite(props.width) && (props.width as number) > 0
      ? (props.width as number)
      : TESTBOX_DEFAULT_WIDTH;
  const height =
    typeof props.height === 'number' && Number.isFinite(props.height) && (props.height as number) > 0
      ? (props.height as number)
      : TESTBOX_DEFAULT_HEIGHT;
  const selected = props.selected === true;
  return (
    <div
      data-testid="testbox"
      data-id={props.id}
      data-selected={selected ? true : undefined}
      role="group"
      aria-label="Test box"
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        props.onObjectPointerDown?.(e);
      }}
      style={{
        position: 'absolute',
        left: props.x,
        top: props.y,
        width,
        height,
        background: '#e8e8e8',
        border: '1px solid #999999',
        outline: selected ? '2px solid #1A73E8' : 'none',
        outlineOffset: 2,
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
}

function pointInTestbox(obj: ObjectSnapshot, p: Point): boolean {
  const b = objectBounds(obj);
  return p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
}

if (!getObjectType('testbox')) {
  registerObjectType('testbox', {
    Component: TestboxComponent,
    resizable: true,
    aspectLocked: false,
    minSize: TESTBOX_MIN_SIZE,
    editableText: false,
    hitTest: pointInTestbox,
  });
}
