import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { rectContains } from '../../src/shared/geometry';

// Test-only object type proving the selection/transform pipeline is generic:
// resizable, not aspect-locked, min size 10. Imported only by tests.
function Testbox({ obj, selected, editable, onObjectPointerDown }: ObjectProps): JSX.Element {
  const bounds = objectBounds(obj);
  return (
    <div
      data-testid="testbox"
      data-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      className={`testbox${editable ? '' : ' testbox--readonly'}`}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height
      }}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!editable) return;
        onObjectPointerDown(e, obj.id);
      }}
    />
  );
}

let registered = false;

export function registerTestbox(): void {
  if (registered) return;
  registered = true;
  registerObjectType('testbox', {
    Component: Testbox,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: (obj, point) =>
      rectContains(objectBounds(obj), { x: point.x, y: point.y, width: 0, height: 0 })
  });
}

// Creates a raw testbox object with an explicit rect (stickies have implicit
// size; the gesture code path for explicit sizes needs this).
export function createTestbox(
  doc: Y.Doc,
  rect: { x: number; y: number; width: number; height: number }
): string {
  const id = `testbox-${Math.random().toString(36).slice(2)}`;
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'testbox');
    obj.set('x', rect.x);
    obj.set('y', rect.y);
    obj.set('width', rect.width);
    obj.set('height', rect.height);
    obj.set('z', 1);
    doc.getMap('objects').set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

export type { ObjectSnapshot };
