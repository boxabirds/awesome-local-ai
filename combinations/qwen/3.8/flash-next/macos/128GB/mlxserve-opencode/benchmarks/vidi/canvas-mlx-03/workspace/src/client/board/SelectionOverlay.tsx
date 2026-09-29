// The selection overlay (design `sel.transform`).
//
// One blue box surrounds the whole selection with eight square handles — four
// corners and four edges — that resize every selected object together. The box
// and handles are drawn in *screen* space, so a handle is HANDLE_SIZE_PX on
// screen whatever the zoom is; the objects themselves live in the zoomed world
// layer.
//
// The container lets pointer events through (moving the board or a single object
// must still work); only the handles capture them.

import type { ReactElement } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model.ts';
import {
  HANDLES,
  HANDLE_CURSORS,
  HANDLE_LABELS,
  unionRects,
  handleEast,
  handleWest,
  handleNorth,
  handleSouth,
  type Point,
  type Rect,
  type Handle,
} from '../../shared/geometry.ts';
import { HANDLE_SIZE_PX } from '../../shared/config.ts';
import { worldToScreen, type Camera } from '../canvas/camera.ts';
import { getObjectType } from '../objects/registry.tsx';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  /** Pointer press on a resize handle. */
  onHandlePointerDown(e: React.PointerEvent<HTMLElement>, h: Handle): void;
}

/** Where a handle sits on its box, in world units. */
function handleAnchor(box: Rect, h: Handle): Point {
  const x = handleWest(h) ? box.x : handleEast(h) ? box.x + box.width : box.x + box.width / 2;
  const y = handleNorth(h) ? box.y : handleSouth(h) ? box.y + box.height : box.y + box.height / 2;
  return { x, y };
}

/** True when at least one selected object's type may be resized at all. */
export function selectionResizable(ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[]): boolean {
  for (const o of snapshot) {
    if (ids.has(o.id) && (getObjectType(o.type)?.resizable ?? false)) return true;
  }
  return false;
}

/**
 * The box around every selected object that is still in the document, in world
 * units; null when nothing selected is present. The overlay draws it and the
 * selection bar floats above it, so both agree on where the selection is.
 */
export function selectionBounds(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
): Rect | null {
  const rects: Rect[] = [];
  for (const o of snapshot) {
    if (ids.has(o.id)) rects.push(objectBounds(o));
  }
  return unionRects(rects);
}

/**
 * The selection's bounding box and resize handles, or nothing at all when the
 * selection is empty, has no object left in the document, or holds only objects
 * that cannot be resized (a type that opts out of resizing gets an outline from
 * its own component and no handles).
 */
export function SelectionOverlay(props: SelectionOverlayProps): ReactElement | null {
  const box = selectionBounds(props.ids, props.snapshot);
  if (!box || !selectionResizable(props.ids, props.snapshot)) return null;

  const zoom = props.camera.zoom > 0 ? props.camera.zoom : 1;
  const topLeft = worldToScreen(props.camera, { x: box.x, y: box.y });
  const width = box.width * zoom;
  const height = box.height * zoom;
  const half = HANDLE_SIZE_PX / 2;

  return (
    <div
      data-testid="selection-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      <div
        data-testid="selection-box"
        aria-hidden
        style={{
          position: 'absolute',
          left: topLeft.x,
          top: topLeft.y,
          width,
          height,
          boxSizing: 'border-box',
          border: '1px solid #2f6fed',
          background: 'rgba(47,111,237,0.06)',
          pointerEvents: 'none',
        }}
      />
      {HANDLES.map((h) => {
        const anchor = worldToScreen(props.camera, handleAnchor(box, h));
        return (
          <div
            key={h}
            data-testid="resize-handle"
            data-handle={h}
            role="button"
            aria-label={`Resize ${HANDLE_LABELS[h]}`}
            title={`Resize ${HANDLE_LABELS[h]}`}
            onPointerDown={(e) => {
              e.stopPropagation(); // not a board pan, not an object drag
              props.onHandlePointerDown(e, h);
            }}
            style={{
              position: 'absolute',
              left: anchor.x - half,
              top: anchor.y - half,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              boxSizing: 'border-box',
              background: '#ffffff',
              border: '1px solid #2f6fed',
              borderRadius: 1,
              cursor: HANDLE_CURSORS[h],
              pointerEvents: 'auto',
            }}
          />
        );
      })}
    </div>
  );
}
