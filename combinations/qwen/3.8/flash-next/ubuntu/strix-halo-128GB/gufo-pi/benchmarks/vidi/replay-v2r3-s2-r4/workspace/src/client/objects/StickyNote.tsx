import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

/** Inner padding of a note, in board units. */
const TEXT_PADDING_WORLD = 16;
/** Screen-space size of the floating note toolbar. */
const TOOLBAR_HEIGHT_PX = 32;
const TOOLBAR_GAP_PX = 8;

type Phase = 'idle' | 'pressed' | 'dragging';

interface DragState {
  pointerId: number;
  /** Pointer position on the screen when the note was pressed. */
  sx: number;
  sy: number;
  /** Note position when it was pressed, in board units. */
  x: number;
  y: number;
  phase: Phase;
  /** Position waiting for the next frame. */
  pending: { x: number; y: number } | null;
  raf: number | null;
}

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Delete button on the note toolbar: removes the note and clears the selection. */
  onDelete(id: string): void;
}

/**
 * One sticky note: rendering, selection, drag-to-move and text editing.
 *
 * Interaction states (never stored in the document):
 * Unselected -> Pressed (pointerdown) -> Selected (pointerup within
 * DRAG_THRESHOLD_PX) or Dragging (beyond the threshold, then Selected again).
 * Selected -> Editing (double-click or Enter). Editing -> Selected (Escape) or
 * Unselected (pointer down outside the note).
 *
 * Dragging listens on the document instead of using pointer capture: bringing a
 * note to the front moves its element in the DOM, which would drop pointer
 * capture and stop the drag.
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
  onDelete,
}: StickyNoteProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  // Values the document-level drag listeners must always read fresh.
  const latest = useRef({ doc, zoom, onSelect, noteId: note.id, x: note.x, y: note.y });
  latest.current = { doc, zoom, onSelect, noteId: note.id, x: note.x, y: note.y };

  const ytext = useMemo(() => getStickyText(doc, note.id), [doc, note.id]);
  const textBox = STICKY_SIZE_WORLD - TEXT_PADDING_WORLD * 2;

  // Auto-fit: largest font that keeps the text inside the note. Font sizes are
  // board units, so zoom scales them uniformly and only the text matters.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const next = fitFontSize(el, textBox);
    setFit((prev) =>
      prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next,
    );
  }, [note.text, note.id, textBox]);

  // Drag handlers are created once; everything they need comes from `latest`.
  const dragHandlers = useMemo(() => {
    /** End the interaction. A pending frame is applied only when asked for. */
    const finish = (applyPending: boolean): void => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.raf !== null) cancelAnimationFrame(drag.raf);
      drag.raf = null;
      const pending = drag.pending;
      drag.pending = null;
      dragRef.current = null;
      setDragging(false);
      if (applyPending && pending) {
        moveObject(latest.current.doc, latest.current.noteId, pending.x, pending.y);
      }
    };

    const flush = (): void => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.raf = null;
      const pending = drag.pending;
      if (!pending) return;
      drag.pending = null;
      if (!moveObject(latest.current.doc, latest.current.noteId, pending.x, pending.y)) {
        // The note disappeared mid-drag (deleted by anyone): end quietly.
        finish(false);
      }
    };

    const onMove = (e: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;

      if (drag.phase === 'pressed') {
        // sticky.no_tap_drag: a move of less than the threshold is a press, not a drag.
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.phase = 'dragging';
        setDragging(true);
        // Once per drag: the note under the pointer comes to the front.
        bringToFront(latest.current.doc, latest.current.noteId);
      }

      // Screen delta divided by zoom keeps the grabbed point under the pointer.
      const currentZoom = latest.current.zoom || 1;
      drag.pending = { x: drag.x + dx / currentZoom, y: drag.y + dy / currentZoom };
      if (drag.raf === null) {
        drag.raf = requestAnimationFrame(flush);
      }
    };

    const onUp = (e: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      // sticky.drag_end: land exactly under the pointer, not one frame behind.
      finish(true);
      latest.current.onSelect(latest.current.noteId);
    };

    // sticky.drag_cancel: keep the last position the board already has.
    const onCancel = (e: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      finish(false);
      latest.current.onSelect(latest.current.noteId);
    };

    return { onMove, onUp, onCancel };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (editing) return; // the textarea handles its own events
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (dragRef.current) return; // one pointer at a time
      // Dragging a note must never pan the board (sticky.no_pan).
      e.stopPropagation();

      dragRef.current = {
        pointerId: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        x: note.x,
        y: note.y,
        phase: 'pressed',
        pending: null,
        raf: null,
      };
      document.addEventListener('pointermove', dragHandlers.onMove);
      document.addEventListener('pointerup', dragHandlers.onUp);
      document.addEventListener('pointercancel', dragHandlers.onCancel);
    },
    [editing, note.x, note.y, dragHandlers],
  );

  // A note that disappears mid-drag leaves no listeners or frames behind.
  useEffect(
    () => () => {
      document.removeEventListener('pointermove', dragHandlers.onMove);
      document.removeEventListener('pointerup', dragHandlers.onUp);
      document.removeEventListener('pointercancel', dragHandlers.onCancel);
      const drag = dragRef.current;
      if (drag && drag.raf !== null) cancelAnimationFrame(drag.raf);
      dragRef.current = null;
    },
    [dragHandlers],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // sticky.dblclick_note: an existing note is edited instead of creating a new one.
      e.stopPropagation();
      e.preventDefault();
      if (editing) return;
      onStartEdit(note.id);
    },
    [editing, onStartEdit, note.id],
  );

  // sticky.edit_end: a pointer down outside the note ends editing as unselected.
  useEffect(() => {
    if (!editing) return;
    const handleDocumentPointerDown = (e: Event) => {
      const el = elRef.current;
      const target = e.target;
      if (el && target instanceof Node && el.contains(target)) return;
      onEndEdit('unselected');
    };
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  }, [editing, onEndEdit]);

  const handleColor = useCallback(
    (color: StickyColor) => {
      // Rejections (stale id, unknown colour) are ignored; the selection stays.
      setStickyColor(doc, note.id, color);
    },
    [doc, note.id],
  );

  const background = STICKY_COLORS[note.color] ?? STICKY_COLORS[DEFAULT_STICKY_COLOR];
  const showToolbar = selected && !editing && !dragging;

  // Text is centred in the note. When it no longer fits it is aligned to the top
  // so the hidden part is the end of the text, which is what the fade marks.
  // The measuring element uses the same layout so it wraps text identically.
  const textLayout: React.CSSProperties = {
    display: 'flex',
    alignItems: fit.overflow ? 'flex-start' : 'center',
    justifyContent: 'center',
    textAlign: 'center',
  };

  return (
    <div
      ref={elRef}
      className={selected ? 'sticky-note sticky-note--selected' : 'sticky-note'}
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-z={note.z}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: background,
        zIndex: note.z,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Hidden element used only to measure how large the font can be. */}
      <div
        ref={measureRef}
        className="sticky-note-measure"
        data-testid="sticky-measure"
        aria-hidden="true"
        style={{ ...textLayout, width: textBox, fontSize: fit.fontPx }}
      >
        {note.text}
      </div>

      <div
        className="sticky-note-text"
        data-testid="sticky-text"
        data-overflow={fit.overflow ? 'true' : 'false'}
        style={{ ...textLayout, padding: TEXT_PADDING_WORLD, fontSize: fit.fontPx }}
      >
        {note.text}
      </div>

      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fit.fontPx}
          inset={TEXT_PADDING_WORLD}
          onEnd={onEndEdit}
        />
      ) : null}

      {fit.overflow ? (
        <div className="sticky-note-fade" data-testid="sticky-fade" aria-hidden="true" />
      ) : null}

      {showToolbar ? (
        <div
          className="note-toolbar-anchor"
          style={{
            // Placed above the note in board units, then scaled by 1/zoom so the
            // toolbar keeps the same size at every zoom level.
            top: -(TOOLBAR_HEIGHT_PX + TOOLBAR_GAP_PX) / zoom,
            transform: `scale(${1 / zoom})`,
          }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={() => onDelete(note.id)} />
        </div>
      ) : null}
    </div>
  );
}
