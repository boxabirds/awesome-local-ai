import { useLayoutEffect, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects, type Handle } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  /** The selected object ids. */
  ids: ReadonlySet<string>;
  /** All board objects (to resolve the selection and compute the box). */
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  /** A resize handle was pressed (the generic gesture takes over). */
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
}

interface HandlePos {
  label: string;
  cursor: string;
  fx: number; // fraction of box width
  fy: number; // fraction of box height
}

const HANDLES: Record<Handle, HandlePos> = {
  nw: { label: 'top-left', cursor: 'nwse-resize', fx: 0, fy: 0 },
  n: { label: 'top', cursor: 'ns-resize', fx: 0.5, fy: 0 },
  ne: { label: 'top-right', cursor: 'nesw-resize', fx: 1, fy: 0 },
  e: { label: 'right', cursor: 'ew-resize', fx: 1, fy: 0.5 },
  se: { label: 'bottom-right', cursor: 'nwse-resize', fx: 1, fy: 1 },
  s: { label: 'bottom', cursor: 'ns-resize', fx: 0.5, fy: 1 },
  sw: { label: 'bottom-left', cursor: 'nesw-resize', fx: 0, fy: 1 },
  w: { label: 'left', cursor: 'ew-resize', fx: 0, fy: 0.5 },
};

/**
 * The selection's bounding box and its eight resize handles, drawn in the
 * world layer (story 7, sel.resize): the box size is the union of the
 * selected objects' bounds; handles are zoom-invariant (HANDLE_SIZE_PX on
 * screen) and carry the `Resize <position>` aria-labels. Handles are hidden
 * when none of the selected objects' types is resizable.
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): React.ReactElement | null {
  if (ids.size === 0) return null;
  const byId = new Map(snapshot.map((o) => [o.id, o]));
  const selectedObjs: ObjectSnapshot[] = [];
  for (const id of ids) {
    const o = byId.get(id);
    if (o) selectedObjs.push(o);
  }
  const box = unionRects(selectedObjs.map(objectBounds));
  if (!box) return null;
  const zoom = camera.zoom;
  const handle = HANDLE_SIZE_PX / zoom;
  const borderWidth = 1 / zoom;
  const resizable = selectedObjs.some((o) => getObjectType(o.type)?.resizable);

  return (
    <div
      data-testid="selection-overlay"
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        pointerEvents: 'none',
        zIndex: 999_999_999,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: `${borderWidth}px solid #1565C0`,
          boxSizing: 'border-box',
        }}
      />
      {resizable &&
        (Object.keys(HANDLES) as Handle[]).map((h) => {
          const pos = HANDLES[h];
          return (
            <HandleBox
              key={h}
              handle={h}
              label={pos.label}
              cursor={pos.cursor}
              fx={pos.fx}
              fy={pos.fy}
              size={handle}
              borderWidth={borderWidth}
              onPointerDown={onHandlePointerDown}
            />
          );
        })}
    </div>
  );
}

/**
 * One resize handle. Uses a NATIVE pointerdown listener (like the object
 * components) so `stopPropagation` keeps the viewport's pan/clear handlers
 * from seeing the press — React's synthetic stopPropagation would be too
 * late (the viewport listens natively lower in the tree).
 */
function HandleBox({
  handle,
  label,
  cursor,
  fx,
  fy,
  size,
  borderWidth,
  onPointerDown,
}: {
  handle: Handle;
  label: string;
  cursor: string;
  fx: number;
  fy: number;
  size: number;
  borderWidth: number;
  onPointerDown: (e: PointerEvent, handle: Handle) => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onPointerDown);
  cbRef.current = onPointerDown;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      cbRef.current(e, handle);
    };
    el.addEventListener('pointerdown', handler);
    return () => el.removeEventListener('pointerdown', handler);
  }, [handle]);

  return (
    <div
      ref={ref}
      data-testid={`resize-handle-${handle}`}
      role="button"
      aria-label={`Resize ${label}`}
      style={{
        position: 'absolute',
        left: (fx - 0.5) * size,
        top: (fy - 0.5) * size,
        width: size,
        height: size,
        background: '#fff',
        border: `${borderWidth}px solid #1565C0`,
        cursor,
        pointerEvents: 'auto',
        boxSizing: 'border-box',
      }}
    />
  );
}
