import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import {
  NOTE_TOOLBAR_GAP_PX,
  NOTE_TOOLBAR_H_PX,
  NOTE_TOOLBAR_W_PX,
  NoteToolbar,
} from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';

/** Padding between the note edge and its text, in world units. */
export const STICKY_PADDING_WORLD = 12;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Current camera zoom: screen pixels per world unit. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

type PressState = 'idle' | 'pressed' | 'dragging';

interface Drag {
  pointerId: number;
  /** Pointer position at pointerdown, in screen pixels. */
  startClientX: number;
  startClientY: number;
  /** Note position at pointerdown, in world units; the reference for deltas. */
  baseX: number;
  baseY: number;
  /** Last position written to the document. */
  writtenX: number;
  writtenY: number;
  /** Latest position requested by the pointer, applied on the next frame. */
  pendingX: number;
  pendingY: number;
}

/**
 * One sticky note on the board.
 *
 * Interaction follows the per-note state diagram: a press becomes a drag once
 * the pointer has moved DRAG_THRESHOLD_PX, a press without movement selects,
 * double-click starts editing, and an interrupted drag keeps the last shown
 * position. The board never pans under a note: `pointerdown` stops
 * propagation. Drag deltas are divided by the camera zoom, so the point
 * grabbed stays under the pointer at any zoom level.
 *
 * Position, colour and text live in the Y.Doc; press and drag state is local,
 * as is selection (see `useSelection`).
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
  const [press, setPress] = useState<PressState>('idle');
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const dragRef = useRef<Drag | null>(null);
  const frameRef = useRef<number | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const id = note.id;

  /** Text auto-fit: measured on mount and on text change, never on zoom. */
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const next = fitFontSize(el, STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2);
    setFit((prev) =>
      prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next,
    );
  }, [note.text, id]);

  const writePending = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.pendingX === drag.writtenX && drag.pendingY === drag.writtenY) return;
    // A note deleted mid-drag just stops moving (moveObject returns false).
    moveObject(doc, id, drag.pendingX, drag.pendingY);
    drag.writtenX = drag.pendingX;
    drag.writtenY = drag.pendingY;
  }, [doc, id]);

  const endDrag = useCallback(
    (select: boolean) => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      // Keep the position the drag last reached; nothing snaps back.
      writePending();
      dragRef.current = null;
      setPress('idle');
      // A drag that ends (or is interrupted) leaves the note selected.
      if (select) onSelect(id);
    },
    [id, onSelect, writePending],
  );

  // Unmounted mid-drag (the note was deleted): stop cleanly, never throw.
  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      dragRef.current = null;
    };
  }, []);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // While editing, the pointer belongs to the textarea (caret placement).
    if (editing) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Grabbing a note must never pan the board.
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture can fail if the pointer has already vanished.
    }
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      baseX: note.x,
      baseY: note.y,
      writtenX: note.x,
      writtenY: note.y,
      pendingX: note.x,
      pendingY: note.y,
    };
    setPress('pressed');
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (dragRef.current && press !== 'dragging') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      // The note comes to the front once, when the drag starts.
      bringToFront(doc, id);
      setPress('dragging');
    }
    const scale = zoomRef.current || 1;
    drag.pendingX = drag.baseX + dx / scale;
    drag.pendingY = drag.baseY + dy / scale;
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        writePending();
      });
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    endDrag(true);
  };

  const handlePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    endDrag(true);
  };

  const handleLostPointerCapture = () => {
    if (!dragRef.current) return;
    endDrag(true);
  };

  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Edit the existing note; the viewport must not create a new one here.
    e.stopPropagation();
    onStartEdit(id);
  };

  const noteStyle: CSSProperties = {
    left: note.x,
    top: note.y,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    background: STICKY_COLORS[note.color],
    zIndex: note.z,
  };

  /**
   * The live `Y.Text` while this note is edited. Undefined in the race where
   * the note was deleted in the same tick it rendered as editing: the editor
   * simply never mounts.
   */
  const editingText = editing ? getStickyText(doc, id) : undefined;

  return (
    <div
      data-testid="sticky-note"
      data-sticky-note="true"
      data-sticky-id={id}
      data-selected={selected ? 'true' : 'false'}
      data-press={press}
      data-z={note.z}
      data-color={note.color}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      className={`sticky-note${fit.overflow ? ' sticky-note--overflow' : ''}`}
      style={noteStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
    >
      {/* Hidden twin used only to measure the text, so the measurement pass can
          write font sizes on an element React does not render. */}
      <div
        ref={measureRef}
        data-testid="sticky-note-measure"
        className="sticky-note-measure"
        aria-hidden="true"
        style={{ width: STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2 }}
      >
        {note.text}
      </div>
      <div
        data-testid="sticky-note-text"
        className="sticky-note-text"
        style={{
          fontSize: `${fit.fontPx}px`,
          padding: `${STICKY_PADDING_WORLD}px`,
          visibility: editing ? 'hidden' : 'visible',
        }}
      >
        <span className="sticky-note-text-run">{note.text}</span>
      </div>
      {editing && editingText ? (
        <StickyTextEditor ytext={editingText} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : null}
      {/* The note's toolbar, in screen space: the counter-scale keeps it the
          same size at any zoom. Hidden while dragging or editing. */}
      {selected && !editing && press !== 'dragging' ? (
        <div
          className="note-anchor"
          data-testid="note-toolbar-anchor"
          style={{
            width: NOTE_TOOLBAR_W_PX,
            height: NOTE_TOOLBAR_H_PX,
            // Screen pixels: centred over the note and lifted above it, then
            // counter-scaled so the toolbar keeps its size at any zoom.
            transform: `translate(${(STICKY_SIZE_WORLD * zoom) / 2 - NOTE_TOOLBAR_W_PX / 2}px, ${
              -NOTE_TOOLBAR_H_PX - NOTE_TOOLBAR_GAP_PX
            }px) scale(${1 / (zoom || 1)})`,
            transformOrigin: '0 0',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color) => {
              setStickyColor(doc, id, color);
            }}
            onDelete={() => {
              deleteObject(doc, id);
            }}
          />
        </div>
      ) : null}
      {fit.overflow ? (
        <div className="sticky-note-fade" data-testid="sticky-note-fade" aria-hidden="true" />
      ) : null}
    </div>
  );
}
