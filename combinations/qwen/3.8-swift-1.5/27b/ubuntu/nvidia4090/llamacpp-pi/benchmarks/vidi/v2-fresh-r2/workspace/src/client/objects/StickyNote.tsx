/**
 * Sticky note component: renders, selects, drags, and edits a note.
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import {
  moveObject,
  bringToFront,
  getStickyText,
  deleteObject,
  setStickyColor,
} from '../../shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DRAG_THRESHOLD_PX, type StickyColor } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** Padding for text area in the note (world units). */
const PADDING = 16;
const TEXT_BOX = STICKY_SIZE_WORLD - PADDING * 2;

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(24);
  const [overflow, setOverflow] = useState(false);

  // Drag state
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    noteStartX: number;
    noteStartY: number;
    isDragging: boolean;
  } | null>(null);

  // Fit font when text changes or when switching to display mode
  useEffect(() => {
    if (editing) return; // Only fit in display mode
    const el = ref.current?.querySelector('[data-sticky-display]') as HTMLElement | null;
    if (!el) return;
    const result = fitFontSize(el, TEXT_BOX);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [note.text, note.id, editing]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // Prevent board panning

      if (editing) return; // Don't start drag while editing

      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        noteStartX: note.x,
        noteStartY: note.y,
        isDragging: false,
      };
    },
    [editing, note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!state.isDragging) {
        if (dist < DRAG_THRESHOLD_PX) return;
        // Start dragging
        state.isDragging = true;
        // Bring to front once
        bringToFront(doc, note.id);
      }

      // Move: divide screen delta by zoom to get world delta
      const worldDx = dx / zoom;
      const worldDy = dy / zoom;
      moveObject(doc, note.id, state.noteStartX + worldDx, state.noteStartY + worldDy);
    },
    [doc, note.id, zoom],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state) return;

      e.currentTarget.releasePointerCapture(e.pointerId);
      dragStateRef.current = null;

      // Select the note
      onSelect(note.id);
    },
    [note.id, onSelect],
  );

  const handlePointerCancel = useCallback(
    (_e: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state) return;
      dragStateRef.current = null;
      // Keep last position, select
      onSelect(note.id);
    },
    [note.id, onSelect],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (!editing) {
        onStartEdit(note.id);
      }
    },
    [note.id, editing, onStartEdit],
  );

  const handleDelete = useCallback(() => {
    deleteObject(doc, note.id);
    onSelect(null);
  }, [doc, note.id, onSelect]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      setStickyColor(doc, note.id, c);
    },
    [doc, note.id],
  );

  const color = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Sticky note"
      data-selected={selected || undefined}
      data-testid="sticky-note"
      data-note-id={note.id}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: color,
        borderRadius: 2,
        boxShadow: selected
          ? '0 0 0 2px #1a73e8, 0 2px 8px rgba(0,0,0,0.15)'
          : '0 2px 8px rgba(0,0,0,0.15)',
        cursor: editing ? 'text' : 'grab',
        outline: 'none',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
    >
      {editing ? (
        <StickyTextEditor
          ytext={getStickyText(doc, note.id)!}
          fontPx={fontPx}
          onEnd={onEndEdit}
        />
      ) : (
        <>
          <div
            data-sticky-display
            style={{
              position: 'absolute',
              inset: PADDING,
              overflow: 'hidden',
              fontSize: `${fontPx}px`,
              lineHeight: 1.3,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#333',
              pointerEvents: 'none',
              textAlign: 'center',
            }}
          >
            {note.text}
          </div>
          {overflow && (
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 32,
                background: `linear-gradient(to bottom, transparent, ${color})`,
                pointerEvents: 'none',
              }}
            />
          )}
        </>
      )}

      {selected && !editing && (
        <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
      )}
    </div>
  );
}
