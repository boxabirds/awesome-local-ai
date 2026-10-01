import { useRef, useCallback, type JSX } from 'react';
import type * as Y from 'yjs';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DRAG_THRESHOLD_PX, STICKY_FONT_MAX_PX } from '../../shared/config';
import { moveObject, bringToFront, getStickyText, setStickyColor, deleteObject, type StickySnapshot } from '../../shared/board-model';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable?: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, editable = true, onSelect, onStartEdit, onEndEdit } = props;
  const elRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    noteStartX: number;
    noteStartY: number;
    moved: boolean;
  } | null>(null);

  const color = STICKY_COLORS[note.color] || STICKY_COLORS.yellow;
  const ytext = getStickyText(doc, note.id);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editing) return;
      if (!editable) {
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        noteStartX: note.x,
        noteStartY: note.y,
        moved: false,
      };
      onSelect(note.id);
    },
    [editing, note.id, note.x, note.y, onSelect],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      e.stopPropagation();

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!state.moved && dist >= DRAG_THRESHOLD_PX) {
        state.moved = true;
        bringToFront(doc, note.id);
      }

      if (state.moved) {
        const worldDx = dx / zoom;
        const worldDy = dy / zoom;
        moveObject(doc, note.id, state.noteStartX + worldDx, state.noteStartY + worldDy);
      }
    },
    [doc, note.id, zoom],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      dragStateRef.current = null;
    },
    [],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      dragStateRef.current = null;
    },
    [],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!editable) return;
      onStartEdit(note.id);
    },
    [note.id, onStartEdit, editable],
  );

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-selected={selected || undefined}
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
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        outline: selected ? '3px solid #2196F3' : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : 'grab',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={STICKY_FONT_MAX_PX}
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
            padding: 12,
            boxSizing: 'border-box',
            fontSize: `${STICKY_FONT_MAX_PX}px`,
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {note.text}
        </div>
      )}
      {selected && !editing && (
        <div
          style={{
            position: 'absolute',
            top: -44,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c) => setStickyColor(doc, note.id, c)}
            onDelete={() => {
              deleteObject(doc, note.id);
              onSelect(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
