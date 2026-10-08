/**
 * Selection bounding box + the eight resize handles (story 7,
 * sel.transform). Rendered in screen space over the board; the handles keep
 * a constant HANDLE_SIZE_PX size at every zoom.
 *
 * Handles are only offered when at least one selected type is resizable.
 * Each handle carries `aria-label="Resize <position>"` and
 * `data-testid="resize-handle"` + `data-handle`.
 */
import type { JSX } from 'react';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { HANDLE_SIZE_PX, STICKY_SELECTION_OUTLINE } from '../../shared/config';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle } from '../../shared/geometry';
import { getObjectType, type GesturePointerEvent } from '../objects/registry';

interface Props {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: GesturePointerEvent, handle: Handle): void;
}

/** Where each handle sits on the box: 0..1 in x and y. */
const ANCHORS: Record<Handle, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

const ARIA: Record<Handle, string> = {
  nw: 'Resize top-left',
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
};

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

const ORDER: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function SelectionOverlay({ ids, snapshot, camera, onHandlePointerDown }: Props): JSX.Element | null {
  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) {
    return null;
  }
  const box = unionRects(selected.map(objectBounds));
  if (box === null) {
    return null;
  }
  const anyResizable = selected.some((o) => getObjectType(o.type)?.resizable === true);
  const tl = worldToScreen(camera, { x: box.x, y: box.y });
  const w = box.width * camera.zoom;
  const h = box.height * camera.zoom;

  return (
    <div data-testid="selection-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', touchAction: 'none' }}>
      <div
        data-testid="selection-box"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: `${tl.x}px`,
          top: `${tl.y}px`,
          width: `${w}px`,
          height: `${h}px`,
          border: `1px solid ${STICKY_SELECTION_OUTLINE}`,
        }}
      />
      {anyResizable &&
        ORDER.map((handle) => {
          const a = ANCHORS[handle];
          return (
            <div
              key={handle}
              data-testid="resize-handle"
              data-handle={handle}
              role="button"
              aria-label={ARIA[handle]}
              onPointerDown={(e) => {
                // Capture so the resize gesture keeps its pointer events even
                // when the cursor crosses other board objects (Chromium would
                // otherwise cancel the sequence when it moves over a note).
                // JSDOM lacks the API; the window listeners still work.
                try {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                } catch {
                  // ignore: capture is best-effort
                }
                e.stopPropagation();
                onHandlePointerDown(e, handle);
              }}
              style={{
                position: 'absolute',
                left: `${tl.x + a.x * w - HANDLE_SIZE_PX / 2}px`,
                top: `${tl.y + a.y * h - HANDLE_SIZE_PX / 2}px`,
                width: `${HANDLE_SIZE_PX}px`,
                height: `${HANDLE_SIZE_PX}px`,
                background: '#ffffff',
                border: `1px solid ${STICKY_SELECTION_OUTLINE}`,
                pointerEvents: 'auto',
                touchAction: 'none',
                cursor: CURSORS[handle],
                boxSizing: 'border-box',
              }}
            />
          );
        })}
    </div>
  );
}
