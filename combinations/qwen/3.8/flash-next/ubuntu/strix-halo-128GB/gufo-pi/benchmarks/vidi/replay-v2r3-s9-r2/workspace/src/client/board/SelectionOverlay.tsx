import React from 'react';
import type { Camera, Point } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import type { Handle } from '../../shared/geometry';
import { unionRects } from '../../shared/geometry';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType, handlesFor } from '../objects/registry';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Story 9: types whose height follows their content resize sideways only. */
const HORIZONTAL_HANDLES: Handle[] = ['e', 'w'];

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

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}

function handlePosition(handle: Handle, sx: number, sy: number, sw: number, sh: number, hs: number): Point {
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;
  switch (handle) {
    case 'nw': return { x: sx - hs / 2, y: sy - hs / 2 };
    case 'n': return { x: cx - hs / 2, y: sy - hs / 2 };
    case 'ne': return { x: sx + sw - hs / 2, y: sy - hs / 2 };
    case 'e': return { x: sx + sw - hs / 2, y: cy - hs / 2 };
    case 'se': return { x: sx + sw - hs / 2, y: sy + sh - hs / 2 };
    case 's': return { x: cx - hs / 2, y: sy + sh - hs / 2 };
    case 'sw': return { x: sx - hs / 2, y: sy + sh - hs / 2 };
    case 'w': return { x: sx - hs / 2, y: cy - hs / 2 };
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

/**
 * Draws bounding box and resize handles around the selection in screen space.
 * A selection of horizontally-resizable types only (text) shows the east and
 * west handles, because its height is derived from its content.
 * Also marks each selected object with data-selected="true".
 */
export function SelectionOverlay({ ids, snapshot, camera, onHandlePointerDown }: SelectionOverlayProps) {
  const selectedObjs = snapshot.filter((obj) => ids.has(obj.id));
  if (selectedObjs.length === 0) return null;

  const allHorizontal =
    selectedObjs.length > 0 &&
    selectedObjs.every((obj) => (getObjectType(obj.type)?.handles ?? 'all') === 'horizontal');

  // Bounding box + resize handles: multi-selection, or one object that resizes
  // sideways only (story 9 text).
  if (ids.size < 2 && !allHorizontal) return null;

  const rects = selectedObjs.map((obj) => objectBounds(obj));
  const bbox = unionRects(rects);
  if (!bbox) return null;

  const anyResizable = selectedObjs.some((obj) => {
    const spec = getObjectType(obj.type);
    return spec?.resizable ?? false;
  });
  const visibleHandles = handlesFor(selectedObjs.map((obj) => obj.type)) === 'horizontal'
    ? HORIZONTAL_HANDLES
    : HANDLES;

  const tl = worldToScreen(camera, { x: bbox.x, y: bbox.y });
  const sw = bbox.width * camera.zoom;
  const sh = bbox.height * camera.zoom;
  const hs = HANDLE_SIZE_PX;

  return (
    <>
      {/* Bounding box outline */}
      <div
        data-testid="selection-bounding-box"
        style={{
          position: 'fixed',
          left: tl.x,
          top: tl.y,
          width: sw,
          height: sh,
          border: '1.5px solid #1976D2',
          pointerEvents: 'none',
          zIndex: 999,
        }}
      />
      {/* Resize handles */}
      {anyResizable &&
        visibleHandles.map((h) => {
          const pos = handlePosition(h, tl.x, tl.y, sw, sh, hs);
          return (
            <button
              key={h}
              type="button"
              aria-label={HANDLE_LABELS[h]}
              data-testid={`resize-handle-${h}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e, h);
              }}
              style={{
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                width: hs,
                height: hs,
                padding: 0,
                margin: 0,
                backgroundColor: '#fff',
                border: '1.5px solid #1976D2',
                borderRadius: 1,
                cursor: CURSORS[h],
                zIndex: 1000,
              }}
            />
          );
        })}
    </>
  );
}
