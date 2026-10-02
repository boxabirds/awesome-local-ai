// Sticky note component: render, select, drag, edit.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
}

type InteractionState = 'unselected' | 'pressed' | 'dragging';

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
  // Use a ref for the interaction state machine (synchronous updates)
  const stateRef = useRef<InteractionState>('unselected');
  const [isDragging, setIsDragging] = useState(false);
  const [fontPx, setFontPx] = useState(24);
  const [overflow, setOverflow] = useState(false);

  const elRef = useRef<HTMLDivElement>(null);
  const textElRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const noteStartRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);

  const color = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;

  // Fit font size when text changes (not while editing)
  useEffect(() => {
    if (editing) return;
    const el = textElRef.current;
    if (!el) return;
    const box = STICKY_SIZE_WORLD - 32; // padding
    const result = fitFontSize(el, box);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [note.text, editing]);

  // Clean up rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const flushMove = useCallback(() => {
    rafRef.current = null;
    if (pendingPosRef.current) {
      moveObject(doc, note.id, pendingPosRef.current.x, pendingPosRef.current.y);
      pendingPosRef.current = null;
    }
  }, [doc, note.id]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // Don't let the viewport pan
      e.currentTarget.setPointerCapture(e.pointerId);
      stateRef.current = 'pressed';
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      noteStartRef.current = { x: note.x, y: note.y };
    },
    [note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (stateRef.current === 'unselected' || !pointerStartRef.current || !noteStartRef.current)
        return;

      const dx = e.clientX - pointerStartRef.current.x;
      const dy = e.clientY - pointerStartRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (stateRef.current === 'pressed') {
        if (dist < DRAG_THRESHOLD_PX) return;
        // Start dragging
        stateRef.current = 'dragging';
        setIsDragging(true);
        bringToFront(doc, note.id);
      }

      // Dragging: compute new world position
      const newX = noteStartRef.current.x + dx / zoom;
      const newY = noteStartRef.current.y + dy / zoom;
      pendingPosRef.current = { x: newX, y: newY };

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushMove);
      }
    },
    [doc, note.id, zoom, flushMove],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (stateRef.current === 'unselected') return;
      e.stopPropagation();

      // Flush any pending move
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        flushMove();
      }

      e.currentTarget.releasePointerCapture(e.pointerId);

      const wasDragging = stateRef.current === 'dragging';
      stateRef.current = 'unselected';
      setIsDragging(false);

      // Select the note (if it was a short press without drag)
      if (!wasDragging && pointerStartRef.current) {
        const dx = e.clientX - pointerStartRef.current.x;
        const dy = e.clientY - pointerStartRef.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < DRAG_THRESHOLD_PX) {
          onSelect(note.id);
        }
      }
      // If was dragging, also select
      if (wasDragging) {
        onSelect(note.id);
      }

      pointerStartRef.current = null;
      noteStartRef.current = null;
    },
    [flushMove, onSelect, note.id],
  );

  const handlePointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (stateRef.current === 'unselected') return;
      // Flush any pending move (keep last position)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        flushMove();
      }
      stateRef.current = 'unselected';
      setIsDragging(false);
      // Select the note (it was being interacted with)
      onSelect(note.id);
      pointerStartRef.current = null;
      noteStartRef.current = null;
    },
    [flushMove, onSelect, note.id],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onStartEdit(note.id);
    },
    [onStartEdit, note.id],
  );

  // Get Y.Text for the editor
  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      data-dragging={isDragging || undefined}
      tabIndex={0}
      className="sticky-note"
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: color,
        borderRadius: '4px',
        boxShadow: selected
          ? '0 0 0 2px #1976D2, 0 4px 12px rgba(0,0,0,0.15)'
          : '0 2px 8px rgba(0,0,0,0.12)',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      {/* Text display (not editing) */}
      {!editing && (
        <div
          className="sticky-note__text-wrapper"
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            ref={textElRef}
            className="sticky-note__text"
            style={{
              fontSize: `${fontPx}px`,
              lineHeight: 1.3,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              textAlign: 'center',
              color: '#333',
              maxWidth: '100%',
            }}
          >
            {note.text}
          </div>
        </div>
      )}
      {overflow && !editing && (
        <div
          className="sticky-note__fade"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '32px',
            background: `linear-gradient(to bottom, transparent, ${color})`,
            pointerEvents: 'none',
            borderRadius: '0 0 4px 4px',
          }}
        />
      )}

      {/* Text editor (editing mode) */}
      {editing && ytext && (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      )}

      {/* Note toolbar (selected, not editing, not dragging) */}
      {selected && !editing && !isDragging && (
        <NoteToolbar
          color={note.color}
          onColor={(c) => {
            setStickyColor(doc, note.id, c);
          }}
          onDelete={() => {
            deleteObject(doc, note.id);
            onSelect(null);
          }}
        />
      )}
    </div>
  );
}
