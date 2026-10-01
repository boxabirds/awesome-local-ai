import type { ObjectProps } from '../../src/client/objects/registry';
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';

function Testbox(props: ObjectProps) {
  const { object, selected } = props;
  return (
    <div
      data-testid={`testbox-${object.id}`}
      data-note-id={object.id}
      data-selected={selected ? 'true' : 'false'}
      style={{ position: 'absolute', left: object.x, top: object.y, width: object.width, height: object.height }}
      onPointerDown={(e) => props.onObjectPointerDown(e, object.id)}
    />
  );
}

/** Test-only resizable, non-aspect-locked type; imported only by tests. Safe to import repeatedly. */
export function registerTestbox(): void {
  if (getObjectType('testbox')) return;
  registerObjectType('testbox', {
    Component: Testbox,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: (o, p) => {
      const b = objectBounds(o);
      return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
    },
  });
}
