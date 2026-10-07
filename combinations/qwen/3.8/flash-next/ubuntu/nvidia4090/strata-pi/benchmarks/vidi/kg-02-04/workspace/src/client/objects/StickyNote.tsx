import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
import { fitFontSize } from "./StickyText";
import { NoteToolbar } from "./NoteToolbar";
import { StickyTextEditor, STICKY_TEXT_BOX_WORLD } from "./StickyTextEditor";

/**
 * One sticky note (sticky.interaction).
 *
 * Rendered inside the scaled world layer at its world position, so it scales
 * with board zoom like everything else. Its per-note interaction state —
 * Unselected, Pressed, Selected, Dragging, Editing — is local React state and
 * is never written to the document.
 */
export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, so screen pointer deltas convert to world units. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: "selected" | "unselected"): void;
}

interface DragState {
  pointerId: number;
  /** Press point in screen pixels. */
  startClient: { x: number; y: number };
  /** Note position when the press started, in world units. */
  origin: { x: number; y: number };
  moved: boolean;
  /** Latest target position, applied on the next animation frame. */
  target: { x: number; y: number } | null;
  frame: number | null;
}

interface FitState {
  fontPx: number;
  overflow: boolean;
}

/** Enough of a pointer event to drive a drag (React's events satisfy it). */
interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
}

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const mountedRef = useRef(true);
  const attachedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<FitState>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const zoomSafe = zoom > 0 ? zoom : 1;
  const zoomRef = useRef(zoomSafe);
  zoomRef.current = zoomSafe;

  const cancelPendingFrame = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.frame !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(drag.frame);
    }
    drag.frame = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelPendingFrame();
      dragRef.current = null;
    };
  }, [cancelPendingFrame]);

  // ---- text fit (sticky.text_fit) ----------------------------------------
  useLayoutEffect(() => {
    if (editing) return;
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el, STICKY_TEXT_BOX_WORLD);
    setFit((prev) => (prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next));
  }, [note.text, editing, note.color]);

  // ---- drag (sticky.move) ------------------------------------------------
  const endDrag = useCallback(
    (andSelect: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      cancelPendingFrame();
      // Whatever was last under the pointer is where the note stays.
      if (drag.target) {
        const { x, y } = drag.target;
        drag.target = null;
        moveObject(doc, note.id, x, y);
      }
      dragRef.current = null;
      detachWindowDrag();
      if (mountedRef.current) setDragging(false);
      if (andSelect) onSelect(note.id);
    },
    [cancelPendingFrame, doc, note.id, onSelect],
  );

  const applyTarget = useCallback(() => {
    const drag = dragRef.current;
    if (!drag || !drag.target) return;
    const { x, y } = drag.target;
    drag.target = null;
    // A note deleted by someone else mid-drag: end the interaction silently.
    if (!moveObject(doc, note.id, x, y)) {
      cancelPendingFrame();
      dragRef.current = null;
      detachWindowDrag();
      if (mountedRef.current) setDragging(false);
    }
  }, [cancelPendingFrame, doc, note.id]);

  const scheduleApply = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (typeof requestAnimationFrame !== "function") {
      applyTarget();
      return;
    }
    if (drag.frame === null) {
      drag.frame = requestAnimationFrame(() => {
        const current = dragRef.current;
        if (current) current.frame = null;
        applyTarget();
      });
    }
  }, [applyTarget]);

  const releaseCapture = (event: PointerLike) => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof el.hasPointerCapture === "function" && el.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId);
    }
  };

  const dragMove = useCallback(
    (event: PointerLike) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - drag.startClient.x;
      const dy = event.clientY - drag.startClient.y;

      if (!drag.moved) {
        // Below the threshold this is still a press, which becomes a selection.
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        // Once, when the drag starts: the dragged note is drawn above all others.
        // `false` here only means it was already the topmost note, which is not an error.
        bringToFront(doc, note.id);
        if (mountedRef.current) setDragging(true);
      }

      // Dividing the screen delta by the zoom keeps the grabbed point under the
      // pointer at 50%, 100% or 200%.
      const zoomNow = zoomRef.current;
      drag.target = { x: drag.origin.x + dx / zoomNow, y: drag.origin.y + dy / zoomNow };
      scheduleApply();
    },
    [doc, note.id, scheduleApply],
  );

  const dragEnd = useCallback(
    (event: PointerLike) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      // Whatever was last under the pointer is where the note stays.
      endDrag(true);
    },
    [endDrag],
  );

  /**
   * A drag is listened to on `window`, not only on the note: bringing a note to
   * the front re-orders its DOM node, and a browser releases pointer capture
   * when that happens — element handlers alone would then miss the rest of the
   * drag. The latest implementations are reached through a ref so the attached
   * listeners can stay the same objects from attach to detach.
   */
  const dragImplRef = useRef<{ move: (event: PointerLike) => void; end: (event: PointerLike) => void }>({
    move: () => {},
    end: () => {},
  });
  dragImplRef.current = { move: dragMove, end: dragEnd };

  const windowListeners = useMemo(
    () => ({
      move: (event: PointerEvent) => dragImplRef.current.move(event),
      up: (event: PointerEvent) => {
        releaseCapture(event);
        dragImplRef.current.end(event);
      },
      cancel: (event: PointerEvent) => dragImplRef.current.end(event),
    }),
    [],
  );

  function attachWindowDrag() {
    if (attachedRef.current || typeof window === "undefined") return;
    attachedRef.current = true;
    window.addEventListener("pointermove", windowListeners.move);
    window.addEventListener("pointerup", windowListeners.up);
    window.addEventListener("pointercancel", windowListeners.cancel);
  }

  function detachWindowDrag() {
    if (!attachedRef.current) return;
    attachedRef.current = false;
    window.removeEventListener("pointermove", windowListeners.move);
    window.removeEventListener("pointerup", windowListeners.up);
    window.removeEventListener("pointercancel", windowListeners.cancel);
  }

  // A drag that is still running when the note goes away must not leak listeners.
  useEffect(() => () => detachWindowDrag(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The board must never pan, or clear the selection, because a note was
    // pressed (sticky.no_pan).
    event.stopPropagation();
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // While editing, pointer events belong to the textarea.
    if (editing) return;
    event.preventDefault();

    const el = rootRef.current;
    if (!el) return;
    el.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      origin: { x: note.x, y: note.y },
      moved: false,
      target: null,
      frame: null,
    };
    attachWindowDrag();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => dragMove(event);

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    releaseCapture(event);
    dragEnd(event);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => dragEnd(event);

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Capture can end because the note was re-ordered, not because the drag
    // ended; the window listeners above keep the drag alive, so nothing to do.
    void event;
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A double-click on a note edits it; it must not create a new note.
    event.stopPropagation();
    event.preventDefault();
    onStartEdit(note.id);
  };

  const onColor = (color: StickyColor) => {
    // Model rejections (stale id) are simply ignored.
    setStickyColor(doc, note.id, color);
  };

  const onDelete = () => {
    deleteObject(doc, note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      ref={rootRef}
      className="sticky-note"
      data-sticky-note
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-color={note.color}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: STICKY_COLORS[note.color],
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
    >
      {ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : (
        <>
          <div
            ref={textRef}
            className="sticky-text"
            data-testid="sticky-text"
            style={{ fontSize: `${fit.fontPx}px` }}
          >
            {note.text}
          </div>
          {fit.overflow ? (
            <div className="sticky-overflow-fade" data-testid="sticky-overflow-fade" aria-hidden="true" />
          ) : null}
        </>
      )}
      {showToolbar ? <NoteToolbar color={note.color} onColor={onColor} onDelete={onDelete} zoom={zoom} /> : null}
    </div>
  );
}
