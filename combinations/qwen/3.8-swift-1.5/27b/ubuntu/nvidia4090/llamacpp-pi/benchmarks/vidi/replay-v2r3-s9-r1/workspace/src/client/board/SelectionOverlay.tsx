import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { unionRects, type Handle } from '../../shared/geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import type { Camera } from '../canvas/camera';

interface HandleDef {
  h: Handle;
  label: string;
  fx: number; // 0..1 position along the box
  fy: number;
  cursor: string;
}

/**
 * A single resize handle. Native pointerdown listener (NOT React synthetic)
 * so that stopPropagation runs before the board viewport's native pan
 * listener — the same pattern as StickyNote.
 */
function ResizeHandle({
  testId,
  label,
  style,
  onPointerDown,
}: {
  testId: string;
  label: string;
  style: CSSProperties;
  onPointerDown: (e: PointerEvent) => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onPointerDown);
  cbRef.current = onPointerDown;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fn = (e: PointerEvent) => {
      e.stopPropagation();
      cbRef.current(e);
    };
    el.addEventListener('pointerdown', fn);
    return () => el.removeEventListener('pointerdown', fn);
  }, []);
  return (
    <div
      ref={ref}
      role="button"
      aria-label={`Resize ${label}`}
      data-testid={`resize-handle-${testId}`}
      style={style}
    />
  );
}

const HANDLES: HandleDef[] = [
  { h: 'nw', label: 'top-left', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { h: 'n', label: 'top', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { h: 'ne', label: 'top-right', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { h: 'e', label: 'right', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { h: 'se', label: 'bottom-right', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { h: 's', label: 'bottom', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { h: 'sw', label: 'bottom-left', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { h: 'w', label: 'left', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

/** Story 9: only e/w handles for horizontal-only types. */
const HORIZONTAL_HANDLES: HandleDef[] = HANDLES.filter((h) => h.h === 'e' || h.h === 'w');

/**
 * Story 7 (sel.outline, sel.resize): the world-space selection chrome —
 * a bounding-box outline around the selection and, when any selected object
 * is resizable, the 8 resize handles (constant screen size at any zoom).
 *
 * The outline is pointer-transparent; only the handles capture pointers.
 * Handles are exposed as accessible elements: role="button",
 * aria-label="Resize <position>".
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: PointerEvent, handle: Handle): void;
}): ReactElement | null {
  if (ids.size === 0) return null;
  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;
  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;
  const resizable = selected.some((o) => getObjectType(o.type)?.resizable === true);
  // Story 9: show only e/w handles when ALL selected objects are horizontal-only.
  const allHorizontal = selected.every((o) => getObjectType(o.type)?.handles === 'horizontal');
  const handlesToShow = allHorizontal ? HORIZONTAL_HANDLES : HANDLES;
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const size = HANDLE_SIZE_PX / zoom;

  return (
    <div
      data-testid="selection-overlay"
      data-handles={allHorizontal ? 'horizontal' : 'all'}
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        border: `1.5px solid #1565C0`,
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    >
      {resizable
        ? handlesToShow.map(({ h, label, fx, fy, cursor }) => (
            <ResizeHandle
              key={h}
              testId={h}
              label={label}
              onPointerDown={(e) => onHandlePointerDown(e, h)}
              style={{
                position: 'absolute',
                left: box.width * fx - size / 2,
                top: box.height * fy - size / 2,
                width: size,
                height: size,
                background: '#FFFFFF',
                border: '1px solid #1565C0',
                boxSizing: 'border-box',
                pointerEvents: 'auto',
                cursor,
                touchAction: 'none',
              }}
            />
          ))
        : null}
    </div>
  );
}
