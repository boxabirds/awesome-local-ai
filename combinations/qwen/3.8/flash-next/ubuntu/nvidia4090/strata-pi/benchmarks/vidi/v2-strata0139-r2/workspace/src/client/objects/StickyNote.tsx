import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as Y from "yjs";
import {
  bringToFront,
  deleteObject,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from "../../shared/board-model";
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_BOX_WORLD,
  type StickyColor,
} from "../../shared/config";
import { fitFontSize, textBoxStyle } from "./StickyText";
import { StickyTextEditor } from "./StickyTextEditor";
import { NoteToolbar } from "./NoteToolbar";

/**
 * One sticky note: rendered in the world layer at its board position, so it
 * scales with the board zoom.
 *
 * Interaction state (never stored in the document):
 *   Unselected -> Pressed (pointerdown) -> Selected (pointerup within
 *   DRAG_THRESHOLD_PX) or Dragging (moved at least DRAG_THRESHOLD_PX) ->
 *   Selected. Editing is entered by a double-click or Enter.
 *
 * Every pointer event on a note stops propagation, so the viewport neither
 * pans nor clears the selection while a note is used (sticky.no_pan).
 */
export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom: drag deltas are screen pixels and are divided by it. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: "selected" | "unselected"): void;
}

type DragState = "idle" | "pressed" | "dragging";

/** Placeholder held while a frame is queued, replaced by the real handle. */
const PENDING_FRAME = -1;

interface DragRecord {
  pointerId: number;
  startX: number;
  startY: number;
  /** Note top-left when the press began, in world units. */
  originX: number;
  originY: number;
  dx: number;
  dy: number;
}

interface Fit {
  fontPx: number;
  overflow: boolean;
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
  const id = note.id;

  const noteRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragRecord | null>(null);
  const dragStateRef = useRef<DragState>("idle");
  const frameRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  const [dragState, setDragState] = useState<DragState>("idle");
  const [fit, setFit] = useState<Fit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const setDrag = useCallback((next: DragState) => {
    dragStateRef.current = next;
    setDragState((previous) => (previous === next ? previous : next));
  }, []);

  const noteStillExists = useCallback((): boolean => {
    return doc.getMap<Y.Map<unknown>>("objects").has(id);
  }, [doc, id]);

  // ---- dragging -----------------------------------------------------------

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
  }, []);

  /** One `moveObject` per animation frame, at most. */
  const flushMove = useCallback(() => {
    frameRef.current = null;
    const drag = dragRef.current;
    if (!drag) return;
    // The note was deleted by someone else: end the interaction silently.
    if (!noteStillExists()) {
      dragRef.current = null;
      setDrag("idle");
      return;
    }
    const scale = zoomRef.current;
    moveObject(doc, id, drag.originX + drag.dx / scale, drag.originY + drag.dy / scale);
  }, [doc, id, noteStillExists, setDrag]);

  const scheduleMove = useCallback(() => {
    if (frameRef.current !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      flushMove();
      return;
    }
    // A sentinel first: `flushMove` clears the slot itself, which keeps the
    // throttle correct even if the frame callback runs synchronously.
    frameRef.current = PENDING_FRAME;
    const handle = requestAnimationFrame(flushMove);
    // `flushMove` already cleared the slot when the callback ran synchronously.
    if (frameRef.current === PENDING_FRAME) frameRef.current = handle;
  }, [flushMove]);

  const endDrag = useCallback(
    (select: boolean) => {
      cancelFrame();
      dragRef.current = null;
      setDrag("idle");
      if (select && noteStillExists()) onSelect(id);
    },
    [cancelFrame, noteStillExists, onSelect, id, setDrag],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The board must never pan, and the selection must not clear, because a
    // note was pressed.
    event.stopPropagation();
    if (editing) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    noteRef.current?.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: note.x,
      originY: note.y,
      dx: 0,
      dy: 0,
    };
    setDrag("pressed");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();

    drag.dx = event.clientX - drag.startX;
    drag.dy = event.clientY - drag.startY;

    if (dragStateRef.current !== "dragging") {
      if (Math.hypot(drag.dx, drag.dy) < DRAG_THRESHOLD_PX) return;
      // Brought to front once, so the note is above everything it overlaps.
      bringToFront(doc, id);
      setDrag("dragging");
    }
    scheduleMove();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!dragRef.current) return;
    noteRef.current?.releasePointerCapture?.(event.pointerId);
    endDrag(true);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    // A cancelled drag keeps the last applied position.
    endDrag(true);
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    event.stopPropagation();
    endDrag(true);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A double-click on a note edits it; it must not create another note.
    event.stopPropagation();
    event.preventDefault();
    onStartEdit(id);
  };

  // The toolbar sits inside the viewport's DOM, and the viewport listens for
  // wheel natively (non-passive), i.e. before React sees anything: block those
  // gestures on the toolbar itself so it can never pan or zoom the board.
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const stop = (event: Event) => event.stopPropagation();
    const gestures: Array<[string, AddEventListenerOptions]> = [
      ["wheel", { passive: false }],
      ["pointerdown", {}],
      ["pointerup", {}],
      ["dblclick", {}],
    ];
    for (const [name, options] of gestures) el.addEventListener(name, stop, options);
    return () => {
      for (const [name] of gestures) el.removeEventListener(name, stop);
    };
  }, [selected, editing, dragState]);

  // A pointerdown anywhere outside the note ends editing (sticky.edit_end).
  useEffect(() => {
    if (!editing) return;
    const onOutsidePointerDown = (event: PointerEvent) => {
      const el = noteRef.current;
      if (el && event.target instanceof Node && el.contains(event.target)) return;
      onEndEdit("unselected");
    };
    document.addEventListener("pointerdown", onOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", onOutsidePointerDown);
  }, [editing, onEndEdit]);

  // Interaction cleanup: nothing may outlive the note (TC-37).
  useEffect(
    () => () => {
      cancelFrame();
      dragRef.current = null;
      dragStateRef.current = "idle";
    },
    [cancelFrame],
  );

  // ---- text auto-fit (display mode) --------------------------------------
  useLayoutEffect(() => {
    if (editing) return;
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el, STICKY_TEXT_BOX_WORLD);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [editing, note.text]);

  // ---- rendering -----------------------------------------------------------
  const dragging = dragState === "dragging";
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      ref={noteRef}
      className={`sticky-note${selected ? " is-selected" : ""}`}
      data-testid="sticky-note"
      data-note-id={id}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-overflow={fit.overflow ? "true" : "false"}
      role="group"
      aria-label={`Sticky note, ${note.color}`}
      tabIndex={0}
      style={{
        left: `${round(note.x)}px`,
        top: `${round(note.y)}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: STICKY_COLORS[note.color],
        // Stacking is the document's z, applied as a CSS z-index. The DOM order
        // stays stable, so a drag is never interrupted by the board re-parenting
        // the note (which would release its pointer capture).
        zIndex: note.z,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
    >
      {editing ? (
        <StickyTextEditor
          ytext={textOf(doc, id)}
          fontPx={fit.fontPx}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          ref={textRef}
          className={`sticky-note-text${fit.overflow ? " is-overflow" : ""}`}
          data-testid="sticky-note-text"
          data-overflow={fit.overflow ? "true" : "false"}
          style={textBoxStyle({ fontSize: `${fit.fontPx}px` })}
        >
          {note.text}
        </div>
      )}

      {fit.overflow && !editing ? (
        <div className="sticky-note-fade" data-testid="sticky-note-fade" aria-hidden="true" />
      ) : null}

      {showToolbar ? (
        <div
          ref={anchorRef}
          className="sticky-note-toolbar-anchor"
          data-testid="sticky-note-toolbar-anchor"
          style={{ transform: `scale(${1 / zoomRef.current})` }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color: StickyColor) => {
              setStickyColor(doc, id, color);
            }}
            onDelete={() => {
              dragRef.current = null;
              deleteObject(doc, id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function textOf(doc: Y.Doc, id: string): Y.Text {
  const objects = doc.getMap<Y.Map<unknown>>("objects");
  const entry = objects.get(id);
  const text = entry instanceof Y.Map ? entry.get("text") : undefined;
  if (text instanceof Y.Text) return text;
  // Should not happen: the editor is only mounted for a note in the document.
  return new Y.Text();
}

/**
 * Positions the text box inside the note from the board settings, so CSS does
 * not repeat a board measurement.
 */

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
