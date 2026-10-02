import { useEffect, useRef } from 'react';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';

/**
 * Test-only board object type (design fixture): resizable, NOT aspect-locked,
 * minSize 10. Imported only by tests to prove the selection/resize machinery
 * is generic before stories 9–12 add real types.
 */
function TestBox({ obj, selected, onPointerDown }: ObjectProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onPointerDown);
  cbRef.current = onPointerDown;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      cbRef.current(e);
    };
    el.addEventListener('pointerdown', handler);
    return () => el.removeEventListener('pointerdown', handler);
  }, []);

  return (
    <div
      ref={ref}
      data-testid={`testbox-${obj.id}`}
      data-selected={selected || undefined}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        zIndex: obj.z,
        background: 'rgba(129, 212, 250, 0.6)',
        border: '1px solid #0288d1',
        touchAction: 'none',
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
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});
