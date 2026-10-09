import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type * as Y from "yjs";
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from "../../shared/board-model";
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "../../shared/config";
import { fitFontSize, type FontFit } from "./StickyText";
import { StickyTextEditor } from "./StickyTextEditor";
import { NoteToolbar } from "./NoteToolbar";
import type { EditEnd } from "../board/useSelection";

/**
 * One sticky note: rendering, selection, dragging and editing.
 *
 * Interaction state (Pressed / Dragging / Editing) is per-client and is never
 * written to the document. Geometry stays in world units and the world layer
 * scales it, so a note and its text grow and shrink with zoom.
 */
export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Current camera zoom: converts pointer movement into world units. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EditEnd): void;
}

type Interaction = "idle" | "pressed" | "dragging";

interface DragState {
  pointerId: number;
  startClient: { x: number; y: number };
  /** Note position when the drag began. */
  origin: { x: number; y: number };
  /** Latest screen delta, applied once per animation frame. */
  pending: { dx: number; dy: number } | null;
  /** Last position applied, so an interrupted drag keeps it. */
  latest: { x: number; y: number };
  frame: number | null;
  dragging: boolean;
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

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const docRef = useRef(doc);
  docRef.current = doc;
  const noteIdRef = useRef(note.id);
  noteIdRef.current = note.id;
  const handlersRef = useRef({ onSelect, onStartEdit, onEndEdit });
  handlersRef.current = { onSelect, onStartEdit, onEndEdit };

  const [interaction, setInteraction] = useState<Interaction>("idle");
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const mountedRef = useRef(true);

  const [fontFit, setFontFit] = useState<FontFit>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  /** False once the note is gone from the document (stale id). */
  const noteStillExists = useCallback(
    () => getStickyText(docRef.current, noteIdRef.current) !== undefined,
    [],
  );

  // ---- text auto-fit ------------------------------------------------------
  // Measured in the note's own layout space (board units): the world layer
  // scales uniformly, so one measurement is right at every zoom level.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const fit = fitFontSize(el, STICKY_SIZE_WORLD);
    setFontFit((prev) =>
      prev.fontPx === fit.fontPx && prev.overflow === fit.overflow ? prev : fit,
    );
  }, [note.text]);

  // ---- drag plumbing ------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const drag = dragRef.current;
      if (drag !== null && drag.frame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(drag.frame);
      }
      dragRef.current = null;
    };
  }, []);

  const worldPositionFor = (drag: DragState): { x: number; y: number } => {
    const scale = zoomRef.current > 0 ? zoomRef.current : 1;
    const pending = drag.pending ?? { dx: 0, dy: 0 };
    // Dividing the screen delta by zoom keeps the grabbed point under the
    // pointer at 50%, 100% and 200%.
    return { x: drag.origin.x + pending.dx / scale, y: drag.origin.y + pending.dy / scale };
  };

  const applyPendingMove = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = null;
    if (!drag.dragging || !drag.pending) return;

    if (!noteStillExists()) {
      // The note vanished mid-drag: stop silently, never recreate it.
      dragRef.current = null;
      if (mountedRef.current) setInteraction("idle");
      return;
    }

    const next = worldPositionFor(drag);
    drag.latest = next;
    moveObject(docRef.current, noteIdRef.current, next.x, next.y);
    if (mountedRef.current) {
      setDragPosition((prev) =>
        prev !== null && prev.x === next.x && prev.y === next.y ? prev : next,
      );
    }
  }, [noteStillExists]);

  const scheduleMove = useCallback(() => {
    const drag = dragRef.current;
    if (!drag || drag.frame !== null) return;
    if (typeof requestAnimationFrame === "function") {
      drag.frame = requestAnimationFrame(() => applyPendingMove());
    } else {
      applyPendingMove();
    }
  }, [applyPendingMove]);

  /** Ends the press: the last applied position stays, and the note is selected. */
  const finishDrag = useCallback(
    (applyFinalMove: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.frame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(drag.frame);
        drag.frame = null;
      }
      const wasDragging = drag.dragging;
      if (wasDragging && drag.pending && applyFinalMove && noteStillExists()) {
        const next = worldPositionFor(drag);
        drag.latest = next;
        moveObject(docRef.current, noteIdRef.current, next.x, next.y);
      }
      dragRef.current = null;
      if (!mountedRef.current) return;
      setInteraction("idle");
      setDragPosition(null);
      if (noteStillExists()) handlersRef.current.onSelect(noteIdRef.current);
    },
    [noteStillExists],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A note must never make the board pan or clear its selection.
    event.stopPropagation();
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (editing) return;

    rootRef.current?.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      origin: { x: note.x, y: note.y },
      pending: null,
      latest: { x: note.x, y: note.y },
      frame: null,
      dragging: false,
    };
    setInteraction("pressed");
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const dx = event.clientX - drag.startClient.x;
    const dy = event.clientY - drag.startClient.y;

    if (!drag.dragging) {
      // A short press without movement is a selection, not a drag.
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      // Once per drag: the dragged note is drawn above everything it overlaps.
      if (noteStillExists()) bringToFront(docRef.current, noteIdRef.current);
      if (mountedRef.current) setInteraction("dragging");
    }

    drag.pending = { dx, dy };
    scheduleMove();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    const wasDragging = drag.dragging;
    finishDrag(true);
    rootRef.current?.releasePointerCapture?.(event.pointerId);
    if (wasDragging && mountedRef.current) rootRef.current?.focus?.();
  };

  /** A cancelled or interrupted drag keeps the last shown position. */
  const handlePointerEnd = () => {
    if (!dragRef.current) return;
    finishDrag(true);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Double-clicking a note edits it; it must never create a new one.
    event.stopPropagation();
    event.preventDefault();
    if (editing) return;
    handlersRef.current.onStartEdit(note.id);
  };

  // ---- editing ------------------------------------------------------------
  useEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const el = rootRef.current;
      const target = event.target as Node | null;
      if (el && target && el.contains(target)) return;
      handlersRef.current.onEndEdit("unselected");
    };
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  }, [editing]);

  // When editing ends with the note still selected, focus returns to the note.
  const wasEditingRef = useRef(editing);
  useEffect(() => {
    const wasEditing = wasEditingRef.current;
    wasEditingRef.current = editing;
    if (wasEditing && !editing && selected) rootRef.current?.focus?.();
  }, [editing, selected]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const dragging = interaction === "dragging";
  const x = dragging && dragPosition ? dragPosition.x : note.x;
  const y = dragging && dragPosition ? dragPosition.y : note.y;
  const showToolbar = selected && !editing && !dragging;
  const scale = zoom > 0 ? zoom : 1;
  const color = STICKY_COLORS[note.color];

  return (
    <div
      ref={rootRef}
      className="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-editing={editing ? "true" : "false"}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: color,
        // Paint order comes from the model's z, not from DOM order.
        zIndex: note.z,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onDoubleClick={handleDoubleClick}
      onFocus={() => {
        // Keyboard users reach a note with Tab; focusing it selects it.
        if (!editing) handlersRef.current.onSelect(note.id);
      }}
    >
      <div
        ref={textRef}
        className={`sticky-note-text${fontFit.overflow ? " has-overflow" : ""}`}
        data-testid="sticky-note-text"
        data-overflow={fontFit.overflow ? "true" : "false"}
        style={{
          fontSize: `${fontFit.fontPx}px`,
          visibility: editing ? "hidden" : "visible",
        }}
      >
        {note.text}
        {fontFit.overflow ? (
          // Overflow indicator: a soft fade at the bottom edge, never clipped
          // words or an ellipsis.
          <span
            className="sticky-note-fade"
            aria-hidden="true"
            style={{ background: `linear-gradient(to bottom, transparent, ${color})` }}
          />
        ) : null}
      </div>

      {editing && ytext ? (
        <StickyTextEditor
          key={note.id}
          ytext={ytext}
          fontPx={fontFit.fontPx}
          onEnd={(next) => handlersRef.current.onEndEdit(next)}
        />
      ) : null}

      {showToolbar ? (
        <div
          className="note-toolbar-anchor"
          style={{ transform: `scale(${1 / scale})`, transformOrigin: "0 100%" }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color: StickyColor) => {
              setStickyColor(docRef.current, noteIdRef.current, color);
            }}
            onDelete={() => {
              // The bin removes the note; App clears the now stale selection.
              deleteObject(docRef.current, noteIdRef.current);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
