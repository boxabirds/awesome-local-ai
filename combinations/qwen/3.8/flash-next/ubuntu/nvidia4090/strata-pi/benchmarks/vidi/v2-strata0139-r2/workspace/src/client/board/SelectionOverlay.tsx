import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { objectBounds, type ObjectSnapshot } from "../../shared/board-model";
import { HANDLES, HANDLE_LABELS, unionRects, type Handle } from "../../shared/geometry";
import { HANDLE_HIT_PAD_PX, HANDLE_SIZE_PX, SELECTION_BOX_COLOR } from "../../shared/config";
import type { Camera } from "../canvas/camera";
import { worldToScreen } from "../canvas/camera";
import { getObjectType } from "../objects/registry";

/**
 * The selection's own furniture (`sel.transform`), drawn in screen space so it
 * keeps its size at any zoom: an outline on every selected object, one bounding
 * box around all of them, and the 8 square handles (4 corners, 4 edges) that
 * resize the whole selection from the opposite corner or edge.
 *
 * The box and the outlines let pointer events through — they are marks, not
 * targets. Only the handles are interactive, and they hand their `pointerdown`
 * to `useTransformGesture`, which is where resizing is decided.
 */

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, handle: Handle): void;
}

export function SelectionOverlay({ ids, snapshot, camera, onHandlePointerDown }: SelectionOverlayProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const objects = snapshot.filter((object) => ids.has(object.id) && getObjectType(object.type) !== undefined);
  const box = objects.length > 0 ? unionRects(objects.map((object) => objectBounds(object))) : null;
  const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  // Handles only exist for a selection something can resize.
  const resizable = objects.some((object) => getObjectType(object.type)?.resizable === true);

  // The viewport listens for `wheel` natively, ahead of React, so zooming must
  // be stopped here the same way story 2 stops it on the note toolbar.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    el.addEventListener("wheel", stop, { passive: false });
    el.addEventListener("dblclick", stop);
    return () => {
      el.removeEventListener("wheel", stop);
      el.removeEventListener("dblclick", stop);
    };
  }, [box === null, resizable]);

  if (!box) return null;

  const topLeft = worldToScreen(camera, { x: box.x, y: box.y });
  const width = box.width * zoom;
  const height = box.height * zoom;

  return (
    <div
      ref={rootRef}
      className="selection-overlay"
      data-testid="selection-overlay"
      data-selection-size={objects.length}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: `${round(topLeft.x)}px`,
        top: `${round(topLeft.y)}px`,
        width: `${round(width)}px`,
        height: `${round(height)}px`,
        border: `1px solid ${SELECTION_BOX_COLOR}`,
        pointerEvents: "none",
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {objects.map((object) => {
        const rect = objectBounds(object);
        return (
          <div
            key={object.id}
            className="selection-outline"
            data-testid="selection-outline"
            data-outline-id={object.id}
            style={{
              position: "absolute",
              left: `${round((rect.x - box.x) * zoom)}px`,
              top: `${round((rect.y - box.y) * zoom)}px`,
              width: `${round(rect.width * zoom)}px`,
              height: `${round(rect.height * zoom)}px`,
              pointerEvents: "none",
            }}
          />
        );
      })}

      {resizable
        ? HANDLES.map((handle) => {
            const position = handlePosition(handle, width, height);
            return (
              <button
                key={handle}
                type="button"
                className={`resize-handle resize-handle-${handle}`}
                data-testid={`resize-handle-${handle}`}
                data-handle={handle}
                aria-label={`Resize ${HANDLE_LABELS[handle]}`}
                title={`Resize ${HANDLE_LABELS[handle]}`}
                style={{
                  position: "absolute",
                  left: `${round(position.x - HANDLE_SIZE_PX / 2)}px`,
                  top: `${round(position.y - HANDLE_SIZE_PX / 2)}px`,
                  width: `${HANDLE_SIZE_PX}px`,
                  height: `${HANDLE_SIZE_PX}px`,
                  // A slightly bigger target than the square that is drawn.
                  padding: `${HANDLE_HIT_PAD_PX}px`,
                  pointerEvents: "auto",
                }}
                onPointerDown={(event) => onHandlePointerDown(event, handle)}
              />
            );
          })
        : null}
    </div>
  );
}

/** Handle centre, in the overlay's own (screen) coordinate space. */
function handlePosition(handle: Handle, width: number, height: number): { x: number; y: number } {
  const midX = width / 2;
  const midY = height / 2;
  switch (handle) {
    case "nw":
      return { x: 0, y: 0 };
    case "n":
      return { x: midX, y: 0 };
    case "ne":
      return { x: width, y: 0 };
    case "e":
      return { x: width, y: midY };
    case "se":
      return { x: width, y: height };
    case "s":
      return { x: midX, y: height };
    case "sw":
      return { x: 0, y: height };
    case "w":
      return { x: 0, y: midY };
  }
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
