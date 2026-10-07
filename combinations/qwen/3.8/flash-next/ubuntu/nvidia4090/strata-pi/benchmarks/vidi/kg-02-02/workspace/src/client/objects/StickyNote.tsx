import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
  STICKY_TEXT_MAX_CHARS,
  STICKY_TEXT_PADDING_WORLD,
  type StickyColor,
} from "../../shared/config";
import { counterVisible, fitFontSize } from "./StickyText";
import { NoteToolbar } from "./NoteToolbar";
import { StickyTextEditor } from "./StickyTextEditor";

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, used for drag geometry and to keep the note toolbar screen-sized. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: "selected" | "unselected"): void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  /** Where the note was when the pointer went down (world units). */
  originX: number;
  originY: number;
  zoom: number;
  /** Latest screen-space pointer delta. */
  dx: number;
  dy: number;
  dragging: boolean;
}

/**
 * One sticky note on the board.
 *
 * Interaction states (per client, never stored in the document):
 * Unselected -> Pressed (pointerdown) -> Selected (pointerup within
 * DRAG_THRESHOLD_PX) or Dragging (moved beyond it) -> Selected.
 * Unselected/Selected -> Editing (double-click or Enter) -> Selected (Escape)
 * or Unselected (click outside).
 */
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
  const noteRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
  }, []);

  // ---- dragging -------------------------------------------------------------

  const applyDrag = useCallback(
    (drag: DragState) => {
      // Screen pixels divided by camera zoom -> world units, so the point that
      // was grabbed stays under the pointer at any zoom.
      const applied = moveObject(
        doc,
        note.id,
        drag.originX + drag.dx / drag.zoom,
        drag.originY + drag.dy / drag.zoom,
      );
      if (!applied) {
        // The note disappeared mid-drag (stale id): end silently, write nothing.
        dragRef.current = null;
        frameRef.current = null;
      }
    },
    [doc, note.id],
  );

  const flushDrag = useCallback(() => {
    frameRef.current = null;
    const drag = dragRef.current;
    if (drag) applyDrag(drag);
  }, [applyDrag]);

  useEffect(
    () => () => {
      cancelFrame();
      dragRef.current = null;
    },
    [cancelFrame],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The board must never pan because a note was pressed (sticky.no_pan).
    event.stopPropagation();
    if (editing && (event.target as HTMLElement).tagName === "TEXTAREA") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const el = noteRef.current;
    if (!el) return;
    try {
      el.setPointerCapture?.(event.pointerId);
    } catch {
      // No capture available (jsdom): the note's own handlers still drive it.
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: note.x,
      originY: note.y,
      zoom: zoom || 1,
      dx: 0,
      dy: 0,
      dragging: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    if (!drag.dragging) {
      drag.dragging = true;
      // Once, when the drag starts: the note is drawn above what it overlaps.
      bringToFront(doc, note.id);
      setDragging(true);
    }

    drag.dx = dx;
    drag.dy = dy;
    if (frameRef.current === null && typeof requestAnimationFrame === "function") {
      frameRef.current = requestAnimationFrame(flushDrag);
    } else if (frameRef.current === null) {
      flushDrag();
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>, applyLastDelta: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    cancelFrame();
    // A cancelled drag keeps the position the note was last shown at.
    if (applyLastDelta && drag.dragging) applyDrag(drag);
    if (drag.dragging) setDragging(false);
    onSelect(note.id);
  };

  // ---- editing --------------------------------------------------------------

  useEffect(() => {
    if (!editing) return;
    const onWindowPointerDown = (event: PointerEvent) => {
      const el = noteRef.current;
      if (!el) return;
      if (el.contains(event.target as Node | null)) return;
      // sticky.edit_end: a press outside the note ends editing, text kept.
      onEndEdit("unselected");
    };
    window.addEventListener("pointerdown", onWindowPointerDown, true);
    return () => window.removeEventListener("pointerdown", onWindowPointerDown, true);
  }, [editing, onEndEdit]);

  // ---- text fit -------------------------------------------------------------

  useLayoutEffect(() => {
    const el = noteRef.current?.querySelector<HTMLElement>(".sticky-text");
    if (!el) return;
    const box = STICKY_SIZE_WORLD - 2 * STICKY_TEXT_PADDING_WORLD;
    const result = fitFontSize(el, box);
    setFit((prev) =>
      prev.fontPx === result.fontPx && prev.overflow === result.overflow ? prev : result,
    );
  }, [note.text, editing]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      ref={noteRef}
      className="sticky-note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-overflow={fit.overflow ? "true" : "false"}
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
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
      onLostPointerCapture={(event) => endDrag(event, false)}
      onDoubleClick={(event) => {
        // sticky.create_dblclick negative case: a note edits itself instead of
        // making a new note on the board.
        event.stopPropagation();
        event.preventDefault();
        onStartEdit(note.id);
      }}
    >
      <div className="sticky-body">
        {editing && ytext ? (
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
        ) : (
          <div
            className="sticky-text"
            data-testid="sticky-text"
            style={{ fontSize: `${fit.fontPx}px` }}
          >
            {note.text}
          </div>
        )}
      </div>

      {fit.overflow ? (
        <div className="sticky-fade" data-testid="sticky-overflow" aria-hidden="true" />
      ) : null}

      {counterVisible(note.text.length) ? (
        <div className="sticky-counter" data-testid="sticky-counter">
          {note.text.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      ) : null}

      {showToolbar ? (
        <div
          className="note-toolbar-anchor"
          style={{ transform: `scale(${1 / (zoom || 1)}) translateY(-100%)` }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color: StickyColor) => {
              setStickyColor(doc, note.id, color);
            }}
            onDelete={() => {
              // sticky.delete via the bin button; the selection is dropped when
              // the note disappears from the snapshot.
              deleteObject(doc, note.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
