import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { Camera } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point, Rect, Handle } from '../../shared/geometry';
import { unionRects } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import type { ConnectorEnd } from '../../shared/objects/connector';
import { getObjectType, handlesOf } from '../objects/registry';

export interface SelectionOverlayProps {
  /** The set of selected object ids. */
  ids: ReadonlySet<string>;
  /** Current snapshot for looking up object bounds. */
  snapshot: readonly ObjectSnapshot[];
  /** Camera for world-to-screen conversion. */
  camera: Camera;
  /** Called when a resize handle is pressed. */
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
  /**
   * The rest of the drag. The handle is the element that keeps the pointer once
   * it has been pressed, so every move and the release come to it and have to be
   * handed on — a handle that only ever hears its own pointerdown is a handle
   * that can be pressed and never dragged.
   */
  onHandlePointerMove?(e: ReactPointerEvent): void;
  onHandlePointerUp?(e: ReactPointerEvent): void;
  onHandlePointerCancel?(e: ReactPointerEvent): void;
  /**
   * The two ends of the one arrow the selection holds, in board units, or nothing
   * when the selection is not a single arrow. An arrow is not resized — it has no
   * box of its own, only two ends — so these take the place of the eight handles
   * rather than being added to them.
   */
  connectorEnds?: { id: string; from: Point; to: Point } | null;
  /** One end being dragged to another shape, or out into the air. */
  onEndPointerDown?(e: ReactPointerEvent, id: string, end: ConnectorEnd): void;
  onEndPointerMove?(e: ReactPointerEvent): void;
  onEndPointerUp?(e: ReactPointerEvent): void;
  onEndPointerCancel?(e: ReactPointerEvent): void;
}

const HANDLES: readonly { handle: Handle; label: string; cursor: string }[] = [
  { handle: 'nw', label: 'Resize top-left', cursor: 'nw-resize' },
  { handle: 'n', label: 'Resize top', cursor: 'n-resize' },
  { handle: 'ne', label: 'Resize top-right', cursor: 'ne-resize' },
  { handle: 'e', label: 'Resize right', cursor: 'e-resize' },
  { handle: 'se', label: 'Resize bottom-right', cursor: 'se-resize' },
  { handle: 's', label: 'Resize bottom', cursor: 's-resize' },
  { handle: 'sw', label: 'Resize bottom-left', cursor: 'sw-resize' },
  { handle: 'w', label: 'Resize left', cursor: 'w-resize' },
];

/**
 * Renders the bounding box and resize handles around the current selection.
 * Handles are positioned in screen space (fixed overlay) and sized HANDLE_SIZE_PX.
 * Hidden when no selected type is resizable.
 *
 * A selection whose every resizable object is one whose *height* somebody else
 * decides — a text object's height is the number of lines its text needs — gets
 * the two side handles and nothing else: dragging a top or bottom corner of a
 * heading would ask it to be shorter than its own words. The moment a sticky note
 * is in the selection, all eight handles come back, because the group as a whole
 * has a height that can be scaled.
 */
export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  const forward = (fn: ((e: ReactPointerEvent) => void) | undefined) => (e: ReactPointerEvent) => {
    // The overlay is above the board, not part of it: a drag of a handle is a
    // resize and never a pan, a marquee or a click on empty space.
    e.stopPropagation();
    fn?.(e);
  };

  if (ids.size === 0) return null;

  // Get rects of all selected objects
  const rects: Rect[] = [];
  let anyResizable = false;
  let everyHeightIsDerived = true;

  for (const id of ids) {
    const obj = snapshot.find((s) => s.id === id);
    if (obj === undefined) continue;
    rects.push(objectBounds(obj));
    const spec = getObjectType(obj.type);
    if (spec !== undefined && spec.resizable) {
      anyResizable = true;
      if (handlesOf(obj.type) !== 'horizontal') everyHeightIsDerived = false;
    }
  }

  if (rects.length === 0) return null;

  const boundingBox = unionRects(rects);
  if (boundingBox === null) return null;

  // Convert world rect to screen position
  const screenLeft = (boundingBox.x - camera.x) * camera.zoom;
  const screenTop = (boundingBox.y - camera.y) * camera.zoom;
  const screenWidth = boundingBox.width * camera.zoom;
  const screenHeight = boundingBox.height * camera.zoom;

  const half = HANDLE_SIZE_PX / 2;
  const visible = everyHeightIsDerived ? HANDLES.filter((h) => h.handle === 'w' || h.handle === 'e') : HANDLES;

  // Handle positions (as fractions of the bounding box)
  const positions: Record<Handle, { left: number; top: number }> = {
    nw: { left: screenLeft, top: screenTop },
    n: { left: screenLeft + screenWidth / 2, top: screenTop },
    ne: { left: screenLeft + screenWidth, top: screenTop },
    e: { left: screenLeft + screenWidth, top: screenTop + screenHeight / 2 },
    se: { left: screenLeft + screenWidth, top: screenTop + screenHeight },
    s: { left: screenLeft + screenWidth / 2, top: screenTop + screenHeight },
    sw: { left: screenLeft, top: screenTop + screenHeight },
    w: { left: screenLeft, top: screenTop + screenHeight / 2 },
  };

  return (
    <div className="selection-overlay" data-testid="selection-overlay">
      {/* Bounding box */}
      <div
        className="selection-bounding-box"
        data-testid="selection-bounding-box"
        style={{
          position: 'fixed',
          left: `${screenLeft}px`,
          top: `${screenTop}px`,
          width: `${screenWidth}px`,
          height: `${screenHeight}px`,
        }}
      />
      {/* Resize handles (only when resizable) */}
      {anyResizable && visible.map(({ handle, label, cursor }) => {
        const pos = positions[handle];
        return (
          <div
            key={handle}
            className={`resize-handle resize-handle-${handle}`}
            data-testid={`resize-handle-${handle}`}
            data-handle={handle}
            aria-label={label}
            style={{
              position: 'fixed',
              left: `${pos.left - half}px`,
              top: `${pos.top - half}px`,
              width: `${HANDLE_SIZE_PX}px`,
              height: `${HANDLE_SIZE_PX}px`,
              cursor,
              '--handle-size': `${HANDLE_SIZE_PX}px`,
            } as React.CSSProperties}
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandlePointerDown(e, handle);
            }}
            onPointerMove={forward(props.onHandlePointerMove)}
            onPointerUp={forward(props.onHandlePointerUp)}
            onPointerCancel={forward(props.onHandlePointerCancel)}
            onLostPointerCapture={forward(props.onHandlePointerUp)}
          />
        );
      })}
      {/* The two ends of a selected arrow, which are the only part of it a person
          can hold: an arrow has no box to scale, and an end is the whole of what
          it can be asked to become. */}
      {props.connectorEnds === null || props.connectorEnds === undefined
        ? null
        : (['from', 'to'] as const).map((end) => {
            const at = props.connectorEnds!;
            const point = worldToScreen(camera, end === 'from' ? at.from : at.to);
            return (
              <div
                key={end}
                className={`connector-end-handle connector-end-handle-${end}`}
                data-testid={`connector-end-${end}`}
                data-end={end}
                aria-label={`Move ${end === 'from' ? 'start' : 'arrowhead'} of connector`}
                style={
                  {
                    position: 'fixed',
                    left: `${point.x - half}px`,
                    top: `${point.y - half}px`,
                    width: `${HANDLE_SIZE_PX}px`,
                    height: `${HANDLE_SIZE_PX}px`,
                    '--handle-size': `${HANDLE_SIZE_PX}px`,
                  } as React.CSSProperties
                }
                onPointerDown={(e) => {
                  e.stopPropagation();
                  props.onEndPointerDown?.(e, at.id, end);
                }}
                onPointerMove={forward(props.onEndPointerMove)}
                onPointerUp={forward(props.onEndPointerUp)}
                onPointerCancel={forward(props.onEndPointerCancel)}
                onLostPointerCapture={forward(props.onEndPointerUp)}
              />
            );
          })}
    </div>
  );
}

/** Board units to the screen they are drawn on, which is what the marquee and the
 *  selection overlay both do themselves rather than being handed. */
function worldToScreen(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
}
