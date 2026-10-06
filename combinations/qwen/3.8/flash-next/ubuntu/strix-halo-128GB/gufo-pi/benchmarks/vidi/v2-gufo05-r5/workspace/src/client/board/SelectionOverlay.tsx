/**
 * Selection overlay: per-object outlines, bounding box, and 8 resize handles.
 * Handles are positioned in screen space (constant size at any zoom) and have
 * aria-labels like "Resize top-left".
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>, handle: Handle): void;
}

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

const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The two sides, for an object whose height belongs to its content (story 9). */
const HORIZONTAL_HANDLES: readonly Handle[] = ['e', 'w'];

/**
 * The handles a selection offers: every side of the box, unless every object in the selection
 * takes the two sides only. A mixed selection offers what the objects in it have in common to do
 * with - the group box is resized as a whole, and each object is scaled the way its own type says
 * (a text keeps its font and re-wraps).
 */
export function handlesFor(selected: readonly ObjectSnapshot[]): readonly Handle[] {
  if (selected.length === 0) return HANDLES;
  return selected.every((obj) => (getObjectType(obj.type)?.handles ?? 'all') === 'horizontal')
    ? HORIZONTAL_HANDLES
    : HANDLES;
}

function worldToScreen(cam: Camera, x: number, y: number): { x: number; y: number } {
  return { x: (x - cam.x) * cam.zoom, y: (y - cam.y) * cam.zoom };
}

/** Returns the screen-space bounding box of a world rect. */
function rectToScreen(cam: Camera, rect: Rect) {
  const tl = worldToScreen(cam, rect.x, rect.y);
  return {
    left: tl.x,
    top: tl.y,
    width: rect.width * cam.zoom,
    height: rect.height * cam.zoom,
  };
}

/** Returns the screen position for a handle on a screen-space box. */
function handlePosition(box: { left: number; top: number; width: number; height: number }, handle: Handle) {
  const half = HANDLE_SIZE_PX / 2;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const right = box.left + box.width;
  const bottom = box.top + box.height;

  switch (handle) {
    case 'nw': return { x: box.left - half, y: box.top - half };
    case 'n': return { x: cx - half, y: box.top - half };
    case 'ne': return { x: right - half, y: box.top - half };
    case 'e': return { x: right - half, y: cy - half };
    case 'se': return { x: right - half, y: bottom - half };
    case 's': return { x: cx - half, y: bottom - half };
    case 'sw': return { x: box.left - half, y: bottom - half };
    case 'w': return { x: box.left - half, y: cy - half };
  }
}

const CURSORS: Record<Handle, string> = {
  nw: 'nw-resize',
  n: 'n-resize',
  ne: 'ne-resize',
  e: 'e-resize',
  se: 'se-resize',
  s: 's-resize',
  sw: 'sw-resize',
  w: 'w-resize',
};

export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;

  // Gather selected objects
  const selected = snapshot.filter((obj) => ids.has(obj.id));
  if (selected.length === 0) return null;

  // Compute bounding box in world space
  const bounds = selected.map((obj) => objectBounds(obj));
  const bbox = unionRects(bounds);
  if (!bbox) return null;

  // Convert bounding box to screen space
  const screenBox = rectToScreen(camera, bbox);

  return (
    <div className="selection-overlay" data-testid="selection-overlay" aria-hidden="true">
      {/* Bounding box outline */}
      <div
        className="selection-bbox"
        data-testid="selection-bbox"
        style={{
          left: screenBox.left,
          top: screenBox.top,
          width: screenBox.width,
          height: screenBox.height,
        }}
      />
      {/* resize handles: all 8, or the two sides for an object whose height is derived */}
      {handlesFor(selected).map((handle) => {
        const pos = handlePosition(screenBox, handle);
        return (
          <div
            key={handle}
            className="selection-handle"
            data-handle={handle}
            aria-label={HANDLE_LABELS[handle]}
            role="button"
            style={{
              left: pos.x,
              top: pos.y,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              cursor: CURSORS[handle],
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandlePointerDown(e, handle);
            }}
          />
        );
      })}
    </div>
  );
}
