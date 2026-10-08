import React from 'react';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { unionRects as unionRectsGeo, type Handle } from '@shared/geometry';
import { objectBounds } from '@shared/board-model';
import type { StickySnapshot } from '@shared/board-model';
import { getObjectType } from '../objects/registry';
import { HANDLE_SIZE_PX } from '@shared/config';
import type { HandleMode } from '../objects/registry';

// Handle positions as percentages of bounding box
const CORRECTED_HANDLE_POSITIONS: { handle: Handle; xPct: number; yPct: number }[] = [
  { handle: 'nw', xPct: 0, yPct: 0 },
  { handle: 'n', xPct: 0.5, yPct: 0 },
  { handle: 'ne', xPct: 1, yPct: 0 },
  { handle: 'e', xPct: 1, yPct: 0.5 },
  { handle: 'se', xPct: 1, yPct: 1 },
  { handle: 's', xPct: 0.5, yPct: 1 },
  { handle: 'sw', xPct: 0, yPct: 1 },
  { handle: 'w', xPct: 0, yPct: 0.5 },
];

interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly StickySnapshot[];
  camera: Camera;
  onHandlePointerDown(e: PointerEvent, h: Handle): void;
}

export function SelectionOverlay({ ids, snapshot, camera, onHandlePointerDown }: SelectionOverlayProps) {
  if (ids.size === 0) return null;

  // Compute bounding box of all selected objects
  const rects = snapshot
    .filter((s) => ids.has(s.id))
    .map(objectBounds);
  const bounds = unionRectsGeo(rects);
  if (!bounds || (bounds.width === 0 && bounds.height === 0)) return null;

  // Check if any selected type is resizable and if ALL are horizontal
  let anyResizable = false;
  let allHorizontal = true;
  for (const s of snapshot) {
    if (ids.has(s.id)) {
      const spec = getObjectType(s.type);
      if (spec?.resizable) {
        anyResizable = true;
        const handleMode = spec.handles as HandleMode | undefined;
        if (handleMode !== 'horizontal') {
          allHorizontal = false;
        }
      } else {
        allHorizontal = false;
      }
    }
  }

  // Only show resize handles if any object is resizable
  const showHandles = anyResizable;
  // When all selected objects are horizontal-only, show only E/W handles
  const filteredHandles = showHandles && allHorizontal
    ? CORRECTED_HANDLE_POSITIONS.filter((h) => h.handle === 'e' || h.handle === 'w')
    : CORRECTED_HANDLE_POSITIONS;

  // Screen-space position of bounding box
  const tl = worldToScreen(camera, { x: bounds.x, y: bounds.y });
  const br = worldToScreen(camera, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });

  const bx = tl.x;
  const by = tl.y;
  const bw = br.x - tl.x;
  const bh = br.y - tl.y;

  const handlePx = HANDLE_SIZE_PX;

  return (
    <div
      data-selection-bounds
      style={{
        position: 'absolute',
        left: `${bx}px`,
        top: `${by}px`,
        width: `${bw}px`,
        height: `${bh}px`,
        pointerEvents: 'none',
        zIndex: 95,
      }}
    >
      {/* Outline stroke */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: '1px solid #2196F3',
          boxSizing: 'border-box',
          borderRadius: 2,
          pointerEvents: 'none',
        }}
      />
      {showHandles &&
        filteredHandles.map(({ handle, xPct, yPct }) => {
          const hx = bx + xPct * bw - handlePx / 2;
          const hy = by + yPct * bh - handlePx / 2;
          const screenPos = worldToScreen(camera, { x: bounds.x + xPct * bounds.width, y: bounds.y + yPct * bounds.height });
          
          return (
            <div
              key={handle}
              data-handle={handle}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onHandlePointerDown(e as unknown as PointerEvent, handle);
              }}
              style={{
                position: 'absolute',
                left: `${hx}px`,
                top: `${hy}px`,
                width: `${handlePx}px`,
                height: `${handlePx}px`,
                background: '#fff',
                border: `1px solid #2196F3`,
                borderRadius: 1,
                cursor: `${handle}-resize`,
                pointerEvents: 'auto',
                zIndex: 96,
                boxSizing: 'border-box',
              }}
              aria-label={`Resize ${handle}`}
            />
          );
        })}
    </div>
  );
}
