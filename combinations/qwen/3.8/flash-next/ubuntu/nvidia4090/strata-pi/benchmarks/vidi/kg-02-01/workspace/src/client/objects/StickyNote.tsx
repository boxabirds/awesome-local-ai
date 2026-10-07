import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as Y from "yjs";
import {
  DRAG_THRESHOLD_PX,
  SELECTION_OUTLINE_COLOR,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
} from "../../shared/config";
import {
  bringToFront,
  getStickyText,
  moveObject,
  type StickySnapshot,
} from "../../shared/board-model";
import { fitFontSize, type FitResult } from "./StickyText";
import { StickyTextEditor } from "./StickyTextEditor";

/**
 * One sticky note: render, select, drag, edit.
 *
 * Interaction state (Unselected -> Pressed -> Selected / Dragging -> Editing)
 * is local to this component and never written to the document; only what the
 * user decided (position, colour, text, stacking) goes through board-model.
 *
 * Selection and editing come from props, so the keyboard (Enter, Delete) and
 * the note toolbar drive the same state machine.
 */

export const STICKY_NOTE_TESTID = "sticky-note";
export const STICKY_NOTE_ARIA_LABEL = "Sticky note";

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom: drag deltas are screen pixels and divide by this. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: "selected" | "unselected"): void;
  /** Lets the app hide the note toolbar while dragging (optional). */
  onDragStart?(id: string): void;
  onDragEnd?(id: string): void;
}

interface Press {
  pointerId: number;
  /** Screen point where the press started. */
  startX: number;
  startY: number;
  /** Note top-left, in world units, when the press started. */
  worldX: number;
  worldY: number;
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
  onDragStart,
  onDragEnd,
}: StickyNoteProps) {
  const noteRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  const [fit, setFit] = useState<FitResult>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // Latest props/values for the drag loop, which runs outside React's render.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const idRef = useRef(note.id);
  idRef.current = note.id;
  const handlersRef = useRef({ onSelect, onStartEdit, onDragStart, onDragEnd, doc });
  handlersRef.current = { onSelect, onStartEdit, onDragStart, onDragEnd, doc };

  const pressRef = useRef<Press | null>(null);
  const draggingRef = useRef(false);
  const pendingRef = useRef<{ dx: number; dy: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const listenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: () => void;
  } | null>(null);

  // ---- text auto-fit -----------------------------------------------------
  // Runs on mount and whenever the text changes; zoom scales the whole note
  // uniformly, so the fitted size does not depend on it.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const box = el.clientHeight || STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD;
    const result = fitFontSize(el, box);
    setFit((prev) =>
      prev.fontPx === result.fontPx && prev.overflow === result.overflow
        ? prev
        : result,
    );
  }, [note.text, editing]);

  // ---- drag plumbing -----------------------------------------------------
  const cancelFrame = () => {
    if (frameRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
  };

  const flushDrag = () => {
    frameRef.current = null;
    const press = pressRef.current;
    const delta = pendingRef.current;
    if (!press || !delta) return;

    const factor = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1;
    const ok = moveObject(
      handlersRef.current.doc,
      idRef.current,
      press.worldX + delta.dx / factor,
      press.worldY + delta.dy / factor,
    );
    // The note disappeared mid-drag (stale id): end the interaction silently.
    if (!ok) endPress();
  };

  const startDragIfNeeded = (dx: number, dy: number) => {
    if (draggingRef.current) return true;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return false;

    draggingRef.current = true;
    // Once, at the start of the drag: the note being dragged is on top of
    // everything it overlaps.
    bringToFront(handlersRef.current.doc, idRef.current);
    handlersRef.current.onDragStart?.(idRef.current);
    handlersRef.current.onSelect(idRef.current);
    return true;
  };

  function endPress() {
    cancelFrame();
    const listeners = listenersRef.current;
    if (listeners) {
      window.removeEventListener("pointermove", listeners.move);
      window.removeEventListener("pointerup", listeners.up);
      window.removeEventListener("pointercancel", listeners.cancel);
      listenersRef.current = null;
    }
    pendingRef.current = null;
    pressRef.current = null;
    if (draggingRef.current) {
      draggingRef.current = false;
      handlersRef.current.onDragEnd?.(idRef.current);
    }
  }

  // A note that unmounts mid-gesture (deleted by someone else) must leave no
  // frame and no listener behind.
  useEffect(() => endPress, []);

  // ---- event handlers ----------------------------------------------------
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The board must not pan, and must not clear the selection, when a note
    // is pressed.
    event.stopPropagation();
    if (editing) return; // caret placement inside the note only
    if (event.pointerType === "mouse" && event.button !== 0) return;

    noteRef.current?.setPointerCapture?.(event.pointerId);
    pressRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      worldX: note.x,
      worldY: note.y,
    };
    draggingRef.current = false;

    // Move and release are tracked on the window rather than on the note:
    // bringing a note to front re-orders it in the DOM, which can drop pointer
    // capture, and the gesture must survive that.
    const move = (moveEvent: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== moveEvent.pointerId) return;

      const dx = moveEvent.clientX - press.startX;
      const dy = moveEvent.clientY - press.startY;
      if (!startDragIfNeeded(dx, dy)) return;

      // One write per animation frame, with the newest pointer position.
      pendingRef.current = { dx, dy };
      if (frameRef.current === null) {
        if (typeof requestAnimationFrame === "function") {
          frameRef.current = requestAnimationFrame(flushDrag);
        } else {
          flushDrag();
        }
      }
    };

    const up = (upEvent: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== upEvent.pointerId) return;
      // A press that never passed the threshold is a click: select the note.
      handlersRef.current.onSelect(idRef.current);
      endPress();
    };

    const cancel = () => {
      // Interrupted drag: the note stays where it was last moved to.
      endPress();
    };

    listenersRef.current = { move, up, cancel };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A double-click on a note edits it; it never creates another note.
    event.stopPropagation();
    event.preventDefault();
    onStartEdit(note.id);
  };

  // ---- editing: a pointerdown outside the note ends it -------------------
  useEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const el = noteRef.current;
      const target = event.target;
      if (el && target instanceof Node && el.contains(target)) return;
      onEndEdit("unselected");
    };
    // Capture phase, so a note that stops propagation still cannot keep the
    // edit open.
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  }, [editing, onEndEdit]);

  const background = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;

  return (
    <div
      ref={noteRef}
      className="sticky-note"
      data-testid={STICKY_NOTE_TESTID}
      data-note-id={note.id}
      data-selected={selected ? "true" : "false"}
      data-editing={editing ? "true" : "false"}
      data-dragging={draggingRef.current ? "true" : "false"}
      data-color={note.color}
      data-overflow={fit.overflow ? "true" : "false"}
      role="group"
      aria-label={STICKY_NOTE_ARIA_LABEL}
      tabIndex={0}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        padding: `${STICKY_PADDING_WORLD}px`,
        background,
        zIndex: note.z,
        outline: selected ? `2px solid ${SELECTION_OUTLINE_COLOR}` : "none",
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        // Reaching a note with Tab selects it, so Enter / Delete work from the
        // keyboard without ever touching a pointer.
        if (!editing) onSelect(note.id);
      }}
    >
      <div className="sticky-note-body">
        {editing ? (
          <StickyTextEditor
            ytext={getStickyText(doc, note.id) ?? EMPTY_TEXT}
            fontPx={fit.fontPx}
            onEnd={onEndEdit}
          />
        ) : (
          <div
            className="sticky-text sticky-text-display"
            data-testid="sticky-text"
            style={{ fontSize: `${fit.fontPx}px` }}
          >
            {note.text}
          </div>
        )}

        {fit.overflow ? <div className="note-fade" data-testid="note-fade" aria-hidden="true" /> : null}

        {/* Hidden measuring twin of the text: same width, font and padding. */}
        <div ref={measureRef} className="sticky-measure" aria-hidden="true">
          {note.text}
        </div>
      </div>
    </div>
  );
}

/**
 * Fallback for a note whose `Y.Text` is missing (only possible for a document
 * written by something other than board-model): edits stay local to the page
 * instead of throwing.
 */
const EMPTY_TEXT = new Y.Text();
