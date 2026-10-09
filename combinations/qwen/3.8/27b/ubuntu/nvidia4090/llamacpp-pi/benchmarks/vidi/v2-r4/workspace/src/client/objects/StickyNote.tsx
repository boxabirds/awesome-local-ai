/**
 * A sticky note (story 2, anchor sticky.create / sticky.drag / sticky.delete).
 *
 * A 200×200-world-unit square positioned in world space. Pointer interactions:
 *  - pointerdown (empty, button 0): capture the pointer so a release anywhere
 *    ends the same interaction; stop propagation so the board never pans.
 *  - pointermove: once the screen-space movement reaches DRAG_THRESHOLD_PX
 *    the note enters the Dragging state — the note is brought to the front
 *    (once) and its world position follows the pointer, throttled by
 *    requestAnimationFrame: one moveObject per frame, last position wins.
 *  - pointerup: Selected (a press under the threshold was just a select).
 *  - pointercancel / lostpointercapture: the note stays at its last
 *    applied position and the interaction ends (Selected).
 *  - double-click: start editing (never creates a new note).
 *  - focus (Tab): select the note (a11y, story 16).
 *
 * The note toolbar is rendered in a portal to document.body, positioned in
 * screen space from the camera, so it is never scaled or clipped by the
 * zoomed world layer. It is hidden while editing or dragging.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type * as React from "react";
import type * as Y from "yjs";
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "../../shared/config";
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from "../../shared/board-model";
import { worldToScreen } from "../canvas/camera";
import { useCameraContext } from "../canvas/useCamera";
import { fitFontSize, type FontFit } from "./StickyText";
import { NoteToolbar } from "./NoteToolbar";
import { StickyTextEditor } from "./StickyTextEditor";

interface DragState {
  pointerId: number;
  /** Pointer position (client px) at drag start. */
  startX: number;
  startY: number;
  /** Note position (world units) at drag start. */
  worldX: number;
  worldY: number;
  dragging: boolean;
  /** Target position (world units) waiting for the next rAF. */
  pendingX: number | null;
  pendingY: number | null;
  frame: number | null;
}

export function StickyNote(props: {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Current board zoom (for converting screen deltas to world deltas). */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: "selected" | "unselected"): void;
}): React.JSX.Element {
  const { note, doc, zoom, selected, editing } = props;
  const cameraApi = useCameraContext();
  const textRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<FontFit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const noteId = note.id;

  // Measure the display text and pick the largest fitting font.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || editing) return;
    setFit(fitFontSize(el, STICKY_SIZE_WORLD));
  }, [note.text, editing]);

  const cancelFrame = (frame: number): void => {
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(frame);
    } else {
      clearTimeout(frame);
    }
  };

  // Cancel any in-flight animation frame on unmount.
  useEffect(() => {
    return () => {
      const drag = dragRef.current;
      if (drag && drag.frame !== null) cancelFrame(drag.frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleMove = (drag: DragState): void => {
    if (drag.frame !== null) return; // one pending move at a time
    const run = () => {
      drag.frame = null;
      const x = drag.pendingX;
      const y = drag.pendingY;
      drag.pendingX = null;
      drag.pendingY = null;
      if (x === null || y === null) return;
      if (!moveObject(doc, noteId, x, y)) {
        // The note disappeared while the move was queued: end silently.
        dragRef.current = null;
        setDragging(false);
      }
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      drag.frame = globalThis.requestAnimationFrame(run);
    } else {
      drag.frame = setTimeout(run, 16) as unknown as number;
    }
  };

  /** Flush the pending move (so the note stays at the last shown position). */
  const flushPending = (drag: DragState): void => {
    if (drag.frame !== null) {
      cancelFrame(drag.frame);
      drag.frame = null;
    }
    if (drag.pendingX !== null && drag.pendingY !== null) {
      moveObject(doc, noteId, drag.pendingX, drag.pendingY);
      drag.pendingX = null;
      drag.pendingY = null;
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    // The board must not pan while a note is grabbed (sticky.no_pan).
    event.stopPropagation();
    if (editing) return; // the editor handles its own pointer events
    const el = event.currentTarget;
    if (typeof el.setPointerCapture === "function") {
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // Pointer already released; capture is best-effort.
      }
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      worldX: note.x,
      worldY: note.y,
      dragging: false,
      pendingX: null,
      pendingY: null,
      frame: null,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      setDragging(true);
      bringToFront(doc, noteId);
    }
    drag.pendingX = drag.worldX + dx / zoom;
    drag.pendingY = drag.worldY + dy / zoom;
    scheduleMove(drag);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    flushPending(drag);
    dragRef.current = null;
    setDragging(false);
    props.onSelect(noteId);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Interrupted drag: keep the last *applied* position (TC-21) — the move
    // still queued for the next frame is discarded, not applied.
    if (drag.frame !== null) {
      cancelFrame(drag.frame);
      drag.frame = null;
      drag.pendingX = null;
      drag.pendingY = null;
    }
    dragRef.current = null;
    setDragging(false);
    props.onSelect(noteId);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    // A double-click on an existing note never creates another note.
    event.stopPropagation();
    if (!editing) props.onStartEdit(noteId);
  };

  const onFocus = (): void => {
    // Tab focus selects the note (a11y, story 16).
    if (!editing) props.onSelect(noteId);
  };

  const ytext = getStickyText(doc, noteId);

  const style: React.CSSProperties = {
    left: note.x,
    top: note.y,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    // Stacking (z) is painted, not DOM-ordered: bringToFront may change z
    // mid-drag, and DOM moves would release the active pointer capture.
    zIndex: note.z,
    backgroundColor: STICKY_COLORS[note.color],
    ["--sticky-note-color" as string]: STICKY_COLORS[note.color],
  };

  let toolbar: React.JSX.Element | null = null;
  if (selected && !editing && !dragging) {
    const camera = cameraApi.camera;
    const topLeft = worldToScreen(camera, { x: note.x, y: note.y });
    toolbar = createPortal(
      <div
        className="note-toolbar-anchor"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        style={{
          position: "fixed",
          left: topLeft.x + (STICKY_SIZE_WORLD * camera.zoom) / 2,
          top: topLeft.y - 8,
          transform: "translate(-50%, -100%)",
        }}
      >
        <NoteToolbar
          color={note.color}
          onColor={(c: StickyColor) => setStickyColor(doc, noteId, c)}
          onDelete={() => {
            deleteObject(doc, noteId);
            props.onSelect(null);
          }}
        />
      </div>,
      document.body,
    );
  }

  return (
    <>
      <div
        role="group"
        aria-label="Sticky note"
        data-note-id={noteId}
        data-selected={selected ? "true" : "false"}
        tabIndex={0}
        className="sticky-note"
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onDoubleClick={onDoubleClick}
        onFocus={onFocus}
      >
        {editing && ytext ? (
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={props.onEndEdit} />
        ) : (
          <div
            ref={textRef}
            className="sticky-note__text"
            style={{ fontSize: `${fit.fontPx}px` }}
          >
            {note.text}
          </div>
        )}
        {!editing && fit.overflow && (
          <div className="sticky-note__fade" aria-hidden="true" />
        )}
      </div>
      {toolbar}
    </>
  );
}
