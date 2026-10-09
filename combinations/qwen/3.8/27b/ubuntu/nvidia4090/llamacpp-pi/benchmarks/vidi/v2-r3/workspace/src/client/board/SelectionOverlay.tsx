import type { ReactElement } from 'react';
import {
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  HANDLES,
  HANDLE_NAMES,
  unionRects,
  type Handle,
} from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

/**
 * Story 7 (sel.transform): the bounding box and eight resize handles of the
 * current selection. Rendered in the world layer, positioned in world
 * coordinates; the box border and the handles are counter-scaled by 1/zoom so
 * they keep a constant size on screen.
 *
 * Each handle carries the `Resize <position>` aria-label expected by the tests.
 *
 * Story 9 (text.object): when every selected object is a horizontal-resize
 * type (text), only the e/w handles are shown — text height follows its
 * content and cannot be dragged. Story 10: connector-only selections show
 * no bounding-box handles (the arrow has its own endpoint handles).
 */
export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, h: Handle): void;
}): ReactElement | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;

  const modes = selected.map((o) => getObjectType(o.type)?.handles ?? 'all');
  const handles: readonly Handle[] = modes.every((m) => m === 'horizontal')
    ? ['e', 'w']
    : modes.every((m) => m === 'none')
      ? []
      : HANDLES;

  const zoom = camera.zoom;
  const borderW = 1.5 / zoom;
  const handleSize = HANDLE_SIZE_PX / zoom;
  const half = handleSize / 2;
  const W = box.width;
  const H = box.height;

  return (
    <div
      data-selection-overlay="true"
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: W,
        height: H,
        border: `${borderW}px solid #1a73e8`,
        borderRadius: 2 / zoom,
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    >
      {handles.map((h) => {
        const c = handleCenter(h, W, H);
        return (
          <div
            key={h}
            role="button"
            aria-label={`Resize ${HANDLE_NAMES[h]}`}
            data-resize-handle={h}
            onPointerDown={(e) => onHandlePointerDown(e, h)}
            style={{
              position: 'absolute',
              left: c.x - half,
              top: c.y - half,
              width: handleSize,
              height: handleSize,
              background: '#fff',
              border: `${borderW}px solid #1a73e8`,
              borderRadius: 2 / zoom,
              cursor: handleCursor(h),
              pointerEvents: 'auto',
              boxSizing: 'border-box',
            }}
          />
        );
      })}
    </div>
  );
}

/** Centre of a handle in the box's local coordinates (origin at top-left). */
function handleCenter(h: Handle, W: number, H: number): { x: number; y: number } {
  switch (h) {
    case 'n':
      return { x: W / 2, y: 0 };
    case 'ne':
      return { x: W, y: 0 };
    case 'e':
      return { x: W, y: H / 2 };
    case 'se':
      return { x: W, y: H };
    case 's':
      return { x: W / 2, y: H };
    case 'sw':
      return { x: 0, y: H };
    case 'w':
      return { x: 0, y: H / 2 };
    case 'nw':
      return { x: 0, y: 0 };
  }
}

function handleCursor(h: Handle): string {
  switch (h) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
  }
}
