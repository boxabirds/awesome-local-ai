// Selection outlines + transform handles (story 7).
//
// The per-object highlight (a coloured outline) is drawn by the object itself via
// its `selected` prop; this overlay adds the *group* affordances: one bounding box
// around the whole selection and eight resize handles. The handles live in screen
// space so they stay HANDLE_SIZE_PX on screen at any zoom (the world layer scales
// objects, but this overlay does not), and they only appear when at least one
// selected object's type is resizable. Each handle is keyboard-focusable and named
// "Resize <position>" for assistive tech.

import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import type { Camera, Point } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';

const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'Resize top-left',
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
};

/** The world-space point a handle sits on within `r`. */
function handlePoint(r: Rect, h: Handle): Point {
  const midX = r.x + r.width / 2;
  const midY = r.y + r.height / 2;
  const right = r.x + r.width;
  const bottom = r.y + r.height;
  switch (h) {
    case 'n':
      return { x: midX, y: r.y };
    case 'ne':
      return { x: right, y: r.y };
    case 'e':
      return { x: right, y: midY };
    case 'se':
      return { x: right, y: bottom };
    case 's':
      return { x: midX, y: bottom };
    case 'sw':
      return { x: r.x, y: bottom };
    case 'w':
      return { x: r.x, y: midY };
    case 'nw':
    default:
      return { x: r.x, y: r.y };
  }
}

export interface SelectionOverlayProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  ids: ReadonlySet<string>;
  /** Draw handles only when some selected object's type is resizable. */
  showHandles: boolean;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

/**
 * The screen-space selection overlay: a bounding box and (when resizable) eight
 * resize handles for the whole selection. Renders nothing while the selection is
 * empty.
 */
export function SelectionOverlay({
  camera,
  snapshot,
  ids,
  showHandles,
  onHandlePointerDown,
}: SelectionOverlayProps): ReactElement | null {
  const rects: Rect[] = [];
  for (const obj of snapshot) {
    if (ids.has(obj.id)) rects.push(objectBounds(obj));
  }
  const box = unionRects(rects);
  if (!box) return null;

  const tl = worldToScreen(camera, { x: box.x, y: box.y });

  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147480000 }}
    >
      <div
        className="selection-box"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: tl.x,
          top: tl.y,
          width: box.width * camera.zoom,
          height: box.height * camera.zoom,
        }}
      />
      {showHandles
        ? HANDLES.map((h) => {
            const p = worldToScreen(camera, handlePoint(box, h));
            return (
              <div
                key={h}
                role="button"
                tabIndex={0}
                aria-label={HANDLE_LABELS[h]}
                title={HANDLE_LABELS[h]}
                data-testid={`resize-handle-${h}`}
                className={`resize-handle resize-handle--${h}`}
                style={{
                  position: 'absolute',
                  left: p.x - HANDLE_SIZE_PX / 2,
                  top: p.y - HANDLE_SIZE_PX / 2,
                  width: HANDLE_SIZE_PX,
                  height: HANDLE_SIZE_PX,
                  pointerEvents: 'auto',
                }}
                onPointerDown={(e) => onHandlePointerDown(e, h)}
              />
            );
          })
        : null}
    </div>
  );
}
