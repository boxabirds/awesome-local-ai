import { useCallback, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import { moveObject, bringToFront, getStickyText } from '../../shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DRAG_THRESHOLD_PX } from '../../shared/config';
import { StickyTextEditor } from './StickyTextEditor';


interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  /** When false the note is read-only: no drag, no text edit. */
  canEdit: boolean;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
}

/**
 * A single sticky note on the board. Handles selection, drag-to-move,
 * double-click to edit, and renders the text editor or display text. When
 * `canEdit` is false (board failed to load) the note is read-only.
 */
export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, canEdit, selected, editing, onSelect, onStartEdit, onEndEdit } =
    props;
  const [dragging, setDragging] = useState(false);

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    noteStartX: number;
    noteStartY: number;
    moved: boolean;
  } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Stop propagation so the board doesn't pan
    e.stopPropagation();

    if (!canEdit) return; // Read-only: no selection or drag.
    if (editing) return; // Don't start drag while editing

    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      noteStartX: note.x,
      noteStartY: note.y,
      moved: false,
    };
  }, [canEdit, editing, note.x, note.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || e.pointerId !== state.pointerId) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (!state.moved && distance < DRAG_THRESHOLD_PX) return;

    if (!state.moved) {
      // Just crossed the threshold: enter drag mode
      state.moved = true;
      setDragging(true);
      bringToFront(doc, note.id);
    }

    // Calculate new world position (divide screen delta by zoom)
    const newX = state.noteStartX + dx / zoom;
    const newY = state.noteStartY + dy / zoom;
    pendingPosRef.current = { x: newX, y: newY };

    // Throttle with rAF
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pos = pendingPosRef.current;
        if (pos) {
          moveObject(doc, note.id, pos.x, pos.y);
        }
      });
    }
  }, [doc, note.id, zoom]);

  const endDrag = useCallback(() => {
    const state = dragStateRef.current;
    if (!state) return;

    // Flush any pending position
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      const pos = pendingPosRef.current;
      if (pos) {
        moveObject(doc, note.id, pos.x, pos.y);
      }
    }

    const wasDrag = state.moved;
    dragStateRef.current = null;
    pendingPosRef.current = null;
    setDragging(false);

    if (wasDrag) {
      // Was a drag → selected
      onSelect(note.id);
    } else {
      // Was a click (no movement) → select
      onSelect(note.id);
    }
  }, [doc, note.id, onSelect]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== e.pointerId) return;
    endDrag();
  }, [endDrag]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== e.pointerId) return;
    endDrag();
  }, [endDrag]);

  const handleLostPointerCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== e.pointerId) return;
    endDrag();
  }, [endDrag]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (!canEdit) return; // Read-only: no text editing.
      onStartEdit(note.id);
    },
    [canEdit, note.id, onStartEdit],
  );

  const ytext = getStickyText(doc, note.id);

  const bg = STICKY_COLORS[note.color] || STICKY_COLORS.yellow;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: bg,
        borderRadius: '2px',
        boxShadow: selected
          ? '0 0 0 2px #1a73e8, 0 4px 12px rgba(0,0,0,0.15)'
          : '0 2px 8px rgba(0,0,0,0.12)',
        cursor: dragging ? 'grabbing' : 'grab',
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={24}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          data-testid="sticky-text-display"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px',
            boxSizing: 'border-box',
            fontSize: '24px',
            fontFamily: 'sans-serif',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'center',
            overflow: 'hidden',
            color: '#333',
          }}
        >
          {note.text}
        </div>
      )}

    </div>
  );
}
