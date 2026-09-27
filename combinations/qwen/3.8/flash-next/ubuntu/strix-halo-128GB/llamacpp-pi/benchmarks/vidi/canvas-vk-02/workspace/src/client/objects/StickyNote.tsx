import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Doc } from 'yjs';

import { bringToFront, deleteObject, getStickyText, moveObject, type StickySnapshot } from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { setStickyColor } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** Inner padding of a note in world units (kept in sync with styles.css). */
const NOTE_PADDING = 16;
/** Line height multiplier for note text. */
const LINE_HEIGHT = 1.25;

type DragPhase = 'idle' | 'pressed' | 'dragging';

/**
 * One sticky note (design "sticky.interaction"). It lives in the world layer at
 * its `(x, y)`, scales with the board, and owns the per-note interaction state
 * machine: a press that does not move selects; a move past the drag threshold
 * raises the note and moves it under the pointer without ever panning the board
 * (the board never sees the pointer events, they are stopped here); a
 * double-click starts editing.
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
  const elementRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const [dragging, setDragging] = useState(false);

  // Latest zoom without re-attaching handlers mid-drag.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // --- font fit: largest size that fits, on text change and on mount only. ---
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el === null) return;
    const box = el.clientHeight > 0 ? el.clientHeight : STICKY_SIZE_WORLD;
    const result = fitFontSize(el, box);
    setFit((prev) =>
      prev.fontPx === result.fontPx && prev.overflow === result.overflow ? prev : result,
    );
  }, [note.text]);

  // --- drag state (never in the document) ----------------------------------
  const dragRef = useRef<{
    phase: DragPhase;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dx: number;
    dy: number;
    frame: number | null;
  } | null>(null);

  const applyMove = useCallback(() => {
    const drag = dragRef.current;
    if (drag === null) return;
    const z = zoomRef.current;
    const ok = moveObject(doc, note.id, drag.originX + drag.dx / z, drag.originY + drag.dy / z);
    if (!ok) {
      // The note was deleted mid-drag: stop, no exception, no recreation.
      if (drag.frame !== null) cancelAnimationFrame(drag.frame);
      dragRef.current = null;
      setDragging(false);
    }
  }, [doc, note.id]);

  const scheduleMove = useCallback(() => {
    const drag = dragRef.current;
    if (drag === null || drag.frame !== null) return;
    drag.frame = requestAnimationFrame(() => {
      const current = dragRef.current;
      if (current !== null) current.frame = null;
      applyMove();
    });
  }, [applyMove]);

  const endDrag = useCallback(
    (commit: boolean) => {
      const drag = dragRef.current;
      if (drag === null) return;
      if (drag.frame !== null) {
        cancelAnimationFrame(drag.frame);
        drag.frame = null;
      }
      if (commit && drag.phase === 'dragging') applyMove();
      dragRef.current = null;
      setDragging(false);
      onSelect(note.id);
    },
    [applyMove, onSelect, note.id],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // While editing, the note must neither drag nor let the board clear the
    // selection; the textarea inside handles its own pointer/caret.
    if (editing) {
      event.stopPropagation();
      return;
    }
    // The board behind must not pan on a note press.
    event.stopPropagation();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    try {
      elementRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // No pointer capture in this environment (jsdom); the drag still works.
    }
    dragRef.current = {
      phase: 'pressed',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: note.x,
      originY: note.y,
      dx: 0,
      dy: 0,
      frame: null,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (drag.phase === 'pressed') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.phase = 'dragging';
      setDragging(true);
      // Raise once, when the drag starts, so it comes to the front.
      bringToFront(doc, note.id);
    }
    drag.dx = dx;
    drag.dy = dy;
    scheduleMove();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    try {
      elementRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    endDrag(true);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    // Keep the note at its last shown position.
    endDrag(true);
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    endDrag(true);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Never create a note on a note; edit this one instead.
    event.stopPropagation();
    onStartEdit(note.id);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Enter on a focused but not-yet-editing note starts editing; while editing
    // the event is inside the textarea and never reaches here.
    if (event.key === 'Enter' && !editing) {
      event.preventDefault();
      event.stopPropagation();
      onStartEdit(note.id);
    }
  };

  const handleColor = (color: StickyColor) => {
    setStickyColor(doc, note.id, color);
  };

  const handleDelete = () => {
    deleteObject(doc, note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const background = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;

  return (
    <div
      ref={elementRef}
      className="sticky-note"
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-color={note.color}
      data-z={note.z}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      style={
        {
          position: 'absolute',
          left: note.x,
          top: note.y,
          width: STICKY_SIZE_WORLD,
          height: STICKY_SIZE_WORLD,
          backgroundColor: background,
          zIndex: note.z,
          '--note-bg': background,
        } as CSSProperties
      }
    >
      <div
        ref={textRef}
        className="sticky-note__text"
        data-visible={editing ? 'false' : 'true'}
        style={{
          fontSize: fit.fontPx,
          padding: NOTE_PADDING,
          lineHeight: LINE_HEIGHT,
          color: editing ? 'transparent' : undefined,
        }}
        aria-hidden={editing ? 'true' : undefined}
      >
        {note.text}
      </div>

      {fit.overflow ? <div className="sticky-note__fade" aria-hidden="true" /> : null}

      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fit.fontPx}
          onEnd={onEndEdit}
        />
      ) : null}

      {selected && !editing && !dragging ? (
        <div
          className="sticky-note__chrome"
          style={{ transform: `scale(${1 / zoom})`, transformOrigin: '0 100%' }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      ) : null}
    </div>
  );
}
