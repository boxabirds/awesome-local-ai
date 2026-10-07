import type { ReactNode } from 'react';
import type { Camera, Point } from '@/client/canvas/camera';
import type { Handle, HandlesMode, ObjectTypeSpec } from '@/client/objects/registry';
import type { ObjectSnapshot } from '@/shared/board-model';
import { unionRects } from '@/shared/geometry';
import { HANDLE_SIZE_PX } from '@/shared/config';
import { worldToScreen } from '@/client/canvas/camera';
import { getObjectType } from '@/client/objects/registry';

const HANDLE_NAMES: Record<Handle, string> = {
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
  nw: 'Resize top-left',
};

interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: PointerEvent, h: Handle): void;
}

/**
 * Determine which handles to show.
 * - If exactly one object is selected and its spec has handles='horizontal' → only e/w.
 * - Otherwise → all 8 handles.
 */
function getHandlesForSelection(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
): Handle[] {
  const selectedObjs = snapshot.filter((s) => ids.has(s.id));
  if (selectedObjs.length === 0) return [];

  // Check if every selected object has handles='horizontal'
  let allHorizontal = true;
  for (const obj of selectedObjs) {
    const spec = getObjectType(obj.type);
    const handles = spec?.handles ?? 'all';
    if (handles !== 'horizontal') {
      allHorizontal = false;
      break;
    }
  }

  if (allHorizontal && selectedObjs.length >= 1) {
    return ['e', 'w'];
  }

  return ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
}

/**
 * Renders the selection outline for each selected object, plus a bounding box
 * around all selected objects with 8 resize handles in screen space.
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): ReactNode {
  if (ids.size === 0) return null;

  const bounds = getSelectionBounds(ids, snapshot);
  if (!bounds) return null;

  // Bounding box in screen coords
  const p1 = worldToScreen(camera, { x: bounds.x, y: bounds.y });
  const p2 = worldToScreen(camera, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
  const bx = p1.x;
  const by = p1.y;
  const bw = p2.x - p1.x;
  const bh = p2.y - p1.y;

  // Per-object outlines
  const outlines: ReactNode[] = [];
  for (const obj of snapshot) {
    if (!ids.has(obj.id)) continue;
    const w = (obj.width as number) ?? 200;
    const h = (obj.height as number) ?? 200;
    const sp = worldToScreen(camera, { x: obj.x, y: obj.y });
    const ep = worldToScreen(camera, { x: obj.x + w, y: obj.y + h });
    outlines.push(
      <rect
        key={`outline-${obj.id}`}
        x={sp.x}
        y={sp.y}
        width={ep.x - sp.x}
        height={ep.y - sp.y}
        fill="none"
        stroke="#2979ff"
        strokeWidth={1 / camera.zoom}
        strokeDasharray={`${4 / camera.zoom} ${4 / camera.zoom}`}
      />,
    );
  }

  // Determine which handles to show based on selected types
  const handles = getHandlesForSelection(ids, snapshot);
  const handleElements = handles.map((h) => {
    const pos = handlePosition(h, bx, by, bw, bh);
    const size = HANDLE_SIZE_PX;
    return (
      <div
        key={`handle-${h}`}
        data-testid={`resize-handle-${h}`}
        role="button"
        aria-label={HANDLE_NAMES[h]}
        style={{
          position: 'absolute',
          left: pos.left,
          top: pos.top,
          width: size,
          height: size,
          backgroundColor: '#fff',
          border: `1px solid #2979ff`,
          borderRadius: '2px',
          cursor: 'pointer',
          zIndex: 101,
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onHandlePointerDown(e as unknown as PointerEvent, h);
        }}
      />
    );
  });

  return (
    <>
      {/* SVG overlay for selection outlines and bounding box */}
      <svg
        data-testid="selection-overlay"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 50,
        }}
      >
        {outlines}
        <rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          fill="rgba(41,121,255,0.05)"
          stroke="#2979ff"
          strokeWidth={2 / camera.zoom}
          strokeDasharray={`${6 / camera.zoom} ${3 / camera.zoom}`}
        />
      </svg>
      {/* HTML handles — positioned in screen space for crisp rendering */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 101,
        }}
      >
        {handleElements}
      </div>
    </>
  );
}

/** Get the union rect of all selected objects' bounding boxes. */
function getSelectionBounds(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
): { x: number; y: number; width: number; height: number } | null {
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  for (const obj of snapshot) {
    if (!ids.has(obj.id)) continue;
    const w = (obj.width as number) ?? 200;
    const h = (obj.height as number) ?? 200;
    rects.push({ x: obj.x, y: obj.y, width: w, height: h });
  }
  if (rects.length === 0) return null;
  return unionRects(rects);
}

/** Compute screen-positioned top/left for a handle on the bounding box. */
function handlePosition(
  handle: Handle,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): { left: number; top: number } {
  const halfSize = HANDLE_SIZE_PX / 2;
  switch (handle) {
    case 'n': return { left: bx + bw / 2 - halfSize, top: by - halfSize };
    case 'ne': return { left: bx + bw - halfSize, top: by - halfSize };
    case 'e': return { left: bx + bw - halfSize, top: by + bh / 2 - halfSize };
    case 'se': return { left: bx + bw - halfSize, top: by + bh - halfSize };
    case 's': return { left: bx + bw / 2 - halfSize, top: by + bh - halfSize };
    case 'sw': return { left: bx - halfSize, top: by + bh - halfSize };
    case 'w': return { left: bx - halfSize, top: by + bh / 2 - halfSize };
    case 'nw': return { left: bx - halfSize, top: by - halfSize };
  }
}
