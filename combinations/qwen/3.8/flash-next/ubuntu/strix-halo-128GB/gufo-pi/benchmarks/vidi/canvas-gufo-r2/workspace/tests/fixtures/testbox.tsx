/**
 * A test-only board object type (imported only by tests). Registered as a
 * resizable, non-aspect-locked type with a small minimum size so component
 * tests can prove the selection / resize machinery is generic before real
 * object types arrive in stories 9–12 (PRD sel.all_types).
 */
import type { JSX } from 'react';
import {
  getObjectType,
  registerObjectType,
  type ObjectProps,
} from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';
import { rectContains } from '../../src/shared/geometry';

function TestBox(props: ObjectProps): JSX.Element {
  const bounds = objectBounds(props.obj);
  return (
    <div
      className="test-box"
      data-note-id={props.obj.id}
      data-selected={props.selected ? 'true' : undefined}
      style={{
        position: 'absolute',
        left: `${props.obj.x}px`,
        top: `${props.obj.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        background: '#d0e7ff',
        border: '1px solid #6ea8fe',
        zIndex: props.obj.z,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => props.onObjectPointerDown(e, props.obj.id)}
    />
  );
}

/** Idempotent registration: safe to import from several test files. */
export function registerTestBox(): void {
  if (getObjectType('testbox')) return;
  registerObjectType('testbox', {
    Component: TestBox,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest(obj, worldPoint) {
      return rectContains(objectBounds(obj), {
        x: worldPoint.x,
        y: worldPoint.y,
        width: 0,
        height: 0,
      });
    },
  });
}

registerTestBox();
