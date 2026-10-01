import type { ObjectProps } from '../../src/client/objects/registry';
import { boundsHitTest, getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';

/** Test-only object type: resizable, not aspect-locked, minimum size 10. Imported only by tests. */
export function TestBox({ object, selected, onPointerDown }: ObjectProps) {
  const b = objectBounds({ ...object, width: object.width ?? 100, height: object.height ?? 100 });
  return (
    <div
      role="group"
      aria-label="Test box"
      data-testbox=""
      data-id={object.id}
      data-selected={selected}
      style={{ position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height, zIndex: object.z }}
      onPointerDown={(e) => onPointerDown(e, object.id)}
    />
  );
}

if (!getObjectType('testbox')) {
  registerObjectType('testbox', {
    Component: TestBox, resizable: true, aspectLocked: false, minSize: 10, editableText: false, hitTest: boundsHitTest,
  });
}
