import * as React from 'react';
import type { Camera } from '../canvas/camera';
import type { Rect, Handle } from '../../shared/geometry';
import { worldToScreen, screenToWorld } from '../canvas/camera';
import { unionRects } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
}

const HANDLE_MAP: [Handle, number, number][] = [
  ['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1],
  ['w', -1, 0], ['e', 1, 0],
  ['sw', -1, 1], ['s', 0, 1], ['se', 1, 1],
];

const HANDLE_ARIA_LABELS: Record<Handle, string> = {
  nw: 'Resize top-left',
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
};

export function SelectionOverlay(props: SelectionOverlayProps): React.JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  
  if (ids.size === 0) return null;
  
  // Compute bounding box from selected objects
  const selectedObjs = snapshot.filter((s) => ids.has(s.id));
  const rects = selectedObjs.map((s) => ({ x: s.x, y: s.y, width: s.width ?? 200, height: s.height ?? 200 }));
  const bb = unionRects(rects);
  if (!bb || bb.width <= 0 || bb.height <= 0) return null;

  const bbScreen = worldToScreen(camera, { x: bb.x, y: bb.y });
  const bbScreenRight = worldToScreen(camera, { x: bb.x + bb.width, y: bb.y + bb.height });

  return (
    <>
      {/* Selection outlines for each object */}
      {selectedObjs.map((obj) => {
        const bounds = { x: obj.x, y: obj.y, width: obj.width ?? 200, height: obj.height ?? 200 };
        const tl = worldToScreen(camera, { x: bounds.x, y: bounds.y });
        const br = worldToScreen(camera, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
        return (
          <div
            key={`outline-${obj.id}`}
            style={{
              position: 'absolute',
              left: `${tl.x}px`,
              top: `${tl.y}px`,
              width: `${br.x - tl.x}px`,
              height: `${br.y - tl.y}px`,
              border: '1.5px solid #4a9eff',
              borderRadius: '6px',
              pointerEvents: 'none',
              zIndex: 50,
            }}
            aria-hidden="true"
            data-selected="true"
          />
        );
      })}
      
      {/* Bounding box */}
      <div
        style={{
          position: 'absolute',
          left: `${bbScreen.x}px`,
          top: `${bbScreen.y}px`,
          width: `${bbScreenRight.x - bbScreen.x}px`,
          height: `${bbScreenRight.y - bbScreen.y}px`,
          border: '1.5px dashed #4a9eff',
          borderRadius: '4px',
          pointerEvents: 'none',
          zIndex: 51,
        }}
        aria-hidden="true"
      />
      
      {/* Resize handles */}
      {HANDLE_MAP.map(([handle, dx, dy]) => {
        const cx = bbScreen.x + (bbScreenRight.x - bbScreen.x) * (dx / 2 + 0.5);
        const cy = bbScreen.y + (bbScreenRight.y - bbScreen.y) * (dy / 2 + 0.5);
        return (
          <div
            key={`handle-${handle}`}
            className={`selection-handle selection-handle--${handle}`}
            data-handle={handle}
            aria-label={HANDLE_ARIA_LABELS[handle]}
            style={{
              position: 'absolute',
              left: `${cx - HANDLE_SIZE_PX / 2}px`,
              top: `${cy - HANDLE_SIZE_PX / 2}px`,
              width: `${HANDLE_SIZE_PX}px`,
              height: `${HANDLE_SIZE_PX}px`,
              backgroundColor: '#fff',
              border: `1.5px solid #4a9eff`,
              borderRadius: '1px',
              cursor: `${handle === 'n' || handle === 's' ? 'ns-resize' : handle === 'e' || handle === 'w' ? 'ew-resize' : `${handle}-resize`}`,
              zIndex: 52,
              transform: 'translate(-50%, -50%)',
              transition: 'transform 0.1s',
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandlePointerDown(e.nativeEvent, handle);
            }}
            role="button"
          />
        );
      })}
    </>
  );
}
