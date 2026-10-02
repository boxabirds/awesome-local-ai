import React from 'react';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import type { Handle, Point } from '../../shared/geometry';
import { unionRects } from '../../shared/geometry';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

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

const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

function handlePoint(rect: { x: number; y: number; width: number; height: number }, h: Handle): Point {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  switch (h) {
    case 'nw': return { x: rect.x, y: rect.y };
    case 'n': return { x: cx, y: rect.y };
    case 'ne': return { x: right, y: rect.y };
    case 'e': return { x: right, y: cy };
    case 'se': return { x: right, y: bottom };
    case 's': return { x: cx, y: bottom };
    case 'sw': return { x: rect.x, y: bottom };
    case 'w': return { x: rect.x, y: cy };
  }
}

/**
 * The selection's on-screen furniture: a bounding box and 8 resize handles
 * (sel.resize), sized in screen pixels so they stay the same size at any zoom.
 * Handles are hidden when no selected object type is resizable. Per-object
 * outlines come from each object's own `data-selected` styling.
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps) {
  if (ids.size === 0) return null;
  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;
  const bbox = unionRects(selected.map(objectBounds));
  if (!bbox) return null;

  const anyResizable = selected.some((o) => getObjectType(o.type)?.resizable);

  const tl = worldToScreen(camera, { x: bbox.x, y: bbox.y });
  const br = worldToScreen(camera, { x: bbox.x + bbox.width, y: bbox.y + bbox.height });
  const boxLeft = Math.min(tl.x, br.x);
  const boxTop = Math.min(tl.y, br.y);
  const boxWidth = Math.abs(br.x - tl.x);
  const boxHeight = Math.abs(br.y - tl.y);

  return (
    <div
      data-testid="selection-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}
    >
      <div
        data-testid="selection-bounds"
        style={{
          position: 'absolute',
          left: boxLeft,
          top: boxTop,
          width: boxWidth,
          height: boxHeight,
          border: '1px solid #1976D2',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      />
      {anyResizable &&
        HANDLES.map((h) => {
          const world = handlePoint(bbox, h);
          const p = worldToScreen(camera, world);
          return (
            <button
              key={h}
              type="button"
              aria-label={HANDLE_LABELS[h]}
              data-testid={`resize-handle-${h}`}
              onPointerDown={(e) => onHandlePointerDown(e, h)}
              style={{
                position: 'absolute',
                left: p.x - HANDLE_SIZE_PX / 2,
                top: p.y - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                padding: 0,
                margin: 0,
                backgroundColor: '#fff',
                border: '1px solid #1976D2',
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
