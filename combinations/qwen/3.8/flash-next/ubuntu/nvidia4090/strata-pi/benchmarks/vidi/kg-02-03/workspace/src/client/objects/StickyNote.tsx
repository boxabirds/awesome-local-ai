import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type * as Y from "yjs";
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  objectExists,
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

/**
 * One sticky note in the world layer (story 2).
 *
 * Interaction states, per client (never stored in the document):
 *
 *   Unselected -> Pressed (pointerdown) -> Selected (pointerup, no movement)
 *   Pressed -> Dragging (moved at least DRAG_THRESHOLD_PX) -> Selected
 *   Selected -> Editing (dblclick or Enter) -> Selected (Escape) / Unselected (click outside)
 */
export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Current camera zoom, used to convert screen drag deltas to world units. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: "selected" | "unselected"): void;
}

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
}

interface Drag {
  originX: number;
  originY: number;
  zoom: number;
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
  const pressRef = useRef<Press | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const watchingRef = useRef(false);

  const [dragging, setDragging] = useState(false);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);
  const [textVersion, setTextVersion] = useState(0);

  // ---- text fit (sticky.text_fit) ------------------------------------
  useLayoutEffect(() => {
    const el = rootRef.current?.querySelector<HTMLElement>(
      "[data-testid='sticky-text'], [data-testid='sticky-textarea']",
    );
    if (!el) return;
    const result = fitFontSize(el, el.clientHeight);
    setFontPx((previous) => (previous === result.fontPx ? previous : result.fontPx));
    setOverflow((previous) => (previous === result.overflow ? previous : result.overflow));
  }, [note.text, editing, textVersion]);

  // ---- drag bookkeeping ---------------------------------------------
  const cancelFrame = () => {
    if (frameRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
  };

  const writePosition = useCallback(() => {
    frameRef.current = null;
    const target = pendingRef.current;
    pendingRef.current = null;
    if (!target) return;
    const moved = moveObject(doc, note.id, target.x, target.y);
    // The note disappeared mid-drag (stale id): end the interaction silently.
    if (!moved && !objectExists(doc, note.id)) {
      pressRef.current = null;
      dragRef.current = null;
      setDragging(false);
    }
  }, [doc, note.id]);

  const scheduleWrite = useCallback(() => {
    if (frameRef.current !== null) return;
    if (typeof requestAnimationFrame === "function") {
      frameRef.current = requestAnimationFrame(writePosition);
    } else {
      writePosition();
    }
  }, [writePosition]);

  const finishPress = useCallback(
    (flush: boolean) => {
      if (flush && pendingRef.current) writePosition();
      cancelFrame();
      pendingRef.current = null;
      pressRef.current = null;
      dragRef.current = null;
      setDragging(false);
      stopWindowWatch();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writePosition],
  );

  // A drag must also end when the pointer is released outside the note and the
  // browser gave no pointer capture (or took it back mid-drag).
  const onWindowEnd = useCallback(
    (event: PointerEvent) => {
      if (!pressRef.current) return;
      finishPress(true);
    },
    [finishPress],
  );

  const startWindowWatch = () => {
    if (watchingRef.current) return;
    watchingRef.current = true;
    window.addEventListener("pointerup", onWindowEnd);
    window.addEventListener("pointercancel", onWindowEnd);
  };

  function stopWindowWatch() {
    if (!watchingRef.current) return;
    watchingRef.current = false;
    window.removeEventListener("pointerup", onWindowEnd);
    window.removeEventListener("pointercancel", onWindowEnd);
  }

  useEffect(
    () => () => {
      cancelFrame();
      pressRef.current = null;
      dragRef.current = null;
      pendingRef.current = null;
      if (watchingRef.current) {
        window.removeEventListener("pointerup", onWindowEnd);
        window.removeEventListener("pointercancel", onWindowEnd);
      }
    },
    [onWindowEnd],
  );

  // ---- pointer handlers ---------------------------------------------
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // sticky.no_pan: a press on a note must never reach the viewport.
    event.stopPropagation();
    if (editing) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    pressRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    dragRef.current = null;
    pendingRef.current = null;
    setDragging(false);
    onSelect(note.id);

    try {
      rootRef.current?.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom and older browsers have no pointer capture; dragging still works.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press) return;
    event.stopPropagation();
    if (event.pointerId !== press.pointerId) return;

    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;

    const drag = dragRef.current;
    if (!drag) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still Pressed
      // The dragged note is drawn above everything it overlaps.
      bringToFront(doc, note.id);
      dragRef.current = { originX: note.x, originY: note.y, zoom: zoomRef.current || 1 };
      setDragging(true);
      startWindowWatch();
    }

    const current = dragRef.current;
    if (!current) return;
    // Divide by zoom so the grabbed point stays under the pointer at any zoom.
    pendingRef.current = {
      x: current.originX + dx / current.zoom,
      y: current.originY + dy / current.zoom,
    };
    scheduleWrite();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pressRef.current) return;
    event.stopPropagation();
    finishPress(true); // Dragging -> Selected at the last position
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pressRef.current) return;
    event.stopPropagation();
    finishPress(true); // interrupted drag keeps its last shown position
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pressRef.current) return;
    // Bringing a note to the front moves its DOM node, and browsers answer that
    // with lostpointercapture. Take the pointer back and keep dragging.
    if (dragRef.current) {
      try {
        rootRef.current?.setPointerCapture?.(event.pointerId);
      } catch {
        // Without capture the window listeners still end the drag safely.
      }
      return;
    }
    finishPress(true);
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    // sticky.edit_start: editing this note, never a new one (TC-35).
    event.stopPropagation();
    onSelect(note.id);
    onStartEdit(note.id);
  };

  // ---- toolbar actions ----------------------------------------------
  const onColor = (color: StickyColor) => {
    setStickyColor(doc, note.id, color);
    onSelect(note.id); // keep the selection while recolouring
  };

  const onDelete = () => {
    deleteObject(doc, note.id);
    onSelect(null); // the note is gone, so the selection goes with it
  };

  const showToolbar = selected && !editing && !dragging;
  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  const noteStyle = {
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${STICKY_SIZE_WORLD}px`,
    height: `${STICKY_SIZE_WORLD}px`,
    background: STICKY_COLORS[note.color],
    zIndex: note.z,
    // The text padding is a product setting, so it is passed down as a CSS variable.
    "--sticky-text-padding": `${STICKY_TEXT_PADDING_WORLD}px`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={`sticky-note${overflow ? " sticky-note-overflow" : ""}`}
      data-testid="sticky-note"
      data-note-id={note.id}
      data-note-color={note.color}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={noteStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx}
          onEnd={onEndEdit}
          onTextChange={() => setTextVersion((version) => version + 1)}
        />
      ) : (
        <div
          className="sticky-text"
          data-testid="sticky-text"
          data-editing="false"
          style={{ fontSize: `${fontPx}px` }}
        >
          {note.text}
        </div>
      )}

      {!editing && counterVisible(note.text.length) ? (
        <span className="sticky-counter" data-testid="sticky-counter" aria-live="polite">
          {note.text.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}

      {showToolbar ? (
        <div
          className="note-toolbar-anchor"
          style={{ transform: `scale(${1 / (zoom || 1)})`, transformOrigin: "0 100%" }}
        >
          <NoteToolbar color={note.color} onColor={onColor} onDelete={onDelete} />
        </div>
      ) : null}
    </div>
  );
}
