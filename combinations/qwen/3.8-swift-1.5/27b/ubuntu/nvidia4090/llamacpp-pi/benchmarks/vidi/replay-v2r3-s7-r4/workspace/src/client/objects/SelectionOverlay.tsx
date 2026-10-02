import { unionRects, type Handle, type Point } from '../../shared/geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { getObjectType } from './registry';
import { HANDLE_SIZE_PX } from '../../shared/config';

export const SELECTION_OUTLINE_COLOR = '#1565C0';
export const SELECTION_OUTLINE_TESTID = 'selection-outline';
export const RESIZE_HANDLE_TESTID = 'resize-handle';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

const POSITION_NAMES: Record<Handle, string> = {
  nw: 'northwest',
  n: 'north',
  ne: 'northeast',
  e: 'east',
  se: 'southeast',
  s: 'south',
  sw: 'southwest',
  w: 'west',
};

export interface SelectionOverlayProps {
  objects: readonly ObjectSnapshot[];
  toScreen: (world: Point) => Point;
  zoom: number;
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
}

/**
 * Story 7: the screen-space selection outline.
 *
 * - one bounding box around all selected objects (union)
 * - eight resize handles (8×8 px, constant screen size) when at least one
 *   selected type is resizable (the group gesture skips non-resizable ones)
 *
 * The box itself is pointer-transparent; only the handles are interactive.
 */
export function SelectionOverlay({
  objects,
  toScreen,
  zoom,
  onHandlePointerDown,
}: SelectionOverlayProps): React.ReactElement | null {
  if (objects.length === 0) return null;

  const box = unionRects(objects.map((o) => objectBounds(o)));
  if (!box) return null;

  const tl = toScreen({ x: box.x, y: box.y });
  const width = box.width * zoom;
  const height = box.height * zoom;

  const resizable = objects.some((o) => getObjectType(o.type)?.resizable === true);

  const handlePos = (h: Handle): Point => {
    const cx = tl.x + width / 2;
    const cy = tl.y + height / 2;
    const left = h.includes('w') ? tl.x : h.includes('e') ? tl.x + width : cx;
    const top = h.includes('n') ? tl.y : h.includes('s') ? tl.y + height : cy;
    return { x: left, y: top };
  };

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      <div
        data-testid={SELECTION_OUTLINE_TESTID}
        style={{
          position: 'absolute',
          left: tl.x,
          top: tl.y,
          width,
          height,
          border: `1.5px solid ${SELECTION_OUTLINE_COLOR}`,
          boxSizing: 'border-box',
        }}
      />
      {resizable &&
        HANDLES.map((h) => {
          const p = handlePos(h);
          return (
            <div
              key={h}
              data-testid={`${RESIZE_HANDLE_TESTID}-${h}`}
              data-handle={h}
              role="button"
              aria-label={`Resize ${POSITION_NAMES[h]}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e.nativeEvent, h);
              }}
              style={{
                position: 'absolute',
                left: p.x - HANDLE_SIZE_PX / 2,
                top: p.y - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                background: '#fff',
                border: `1.5px solid ${SELECTION_OUTLINE_COLOR}`,
                boxSizing: 'border-box',
                cursor: CURSORS[h],
                pointerEvents: 'auto',
                touchAction: 'none',
              }}
            />
          );
        })}
    </div>
  );
}
