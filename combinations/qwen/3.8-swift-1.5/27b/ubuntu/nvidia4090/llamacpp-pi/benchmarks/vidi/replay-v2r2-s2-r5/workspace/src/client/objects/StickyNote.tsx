import { useRef, useState, useCallback, useEffect } from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import { getStickyText, moveObject, bringToFront, setStickyColor, deleteObject } from '../../shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DRAG_THRESHOLD_PX, STICKY_FONT_MAX_PX } from '../../shared/config';
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

type InteractionState = 'unselected' | 'pressed' | 'selected' | 'dragging' | 'editing';

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
  const [interactionState, setInteractionState] = useState<InteractionState>(
    editing ? 'editing' : selected ? 'selected' : 'unselected'
  );
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  // Use a ref for interaction state in event handlers to avoid stale closures
  const interactionStateRef = useRef<InteractionState>(interactionState);
  const setBoth = useCallback((s: InteractionState) => {
    interactionStateRef.current = s;
    setInteractionState(s);
  }, []);

  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    noteStartX: number;
    noteStartY: number;
  } | null>(null);
  const textDivRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Fit font size when text changes
  useEffect(() => {
    const el = textDivRef.current;
    if (!el) return;
    const result = fitFontSize(el, STICKY_SIZE_WORLD - 24);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [note.text]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editing) return;
      e.stopPropagation();
      e.preventDefault();

      const el = noteRef.current;
      if (!el) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // jsdom doesn't support pointer capture
      }

      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        noteStartX: note.x,
        noteStartY: note.y,
      };
      setBoth('pressed');
    },
    [editing, note.x, note.y, setBoth]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const currentZoom = zoomRef.current;

      const current = interactionStateRef.current;

      if (current === 'pressed') {
        if (dist >= DRAG_THRESHOLD_PX) {
          setBoth('dragging');
          bringToFront(doc, note.id);
        } else {
          return;
        }
      }

      if (interactionStateRef.current === 'dragging') {
        const worldDx = dx / currentZoom;
        const worldDy = dy / currentZoom;
        const newX = state.noteStartX + worldDx;
        const newY = state.noteStartY + worldDy;

        moveObject(doc, note.id, newX, newY);
      }
    },
    [doc, note.id, setBoth]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      const el = noteRef.current;
      if (el) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }

      dragStateRef.current = null;

      setBoth('selected');
      onSelect(note.id);
    },
    [note.id, onSelect, setBoth]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      const el = noteRef.current;
      if (el) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }

      dragStateRef.current = null;

      setBoth('selected');
      onSelect(note.id);
    },
    [note.id, onSelect, setBoth]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!editing) {
        setBoth('editing');
        onStartEdit(note.id);
      }
    },
    [editing, note.id, onStartEdit, setBoth]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && selected && !editing) {
        e.preventDefault();
        e.stopPropagation();
        setBoth('editing');
        onStartEdit(note.id);
      }
    },
    [selected, editing, note.id, onStartEdit, setBoth]
  );

  const isDragging = interactionState === 'dragging';
  const isEditing = editing || interactionState === 'editing';
  const isSelected = selected || interactionState === 'selected' || interactionState === 'pressed';

  const color = STICKY_COLORS[note.color] || STICKY_COLORS.yellow;
  const ytext = getStickyText(doc, note.id);

  return (
    <div
      ref={noteRef}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={isSelected || undefined}
      data-editing={isEditing || undefined}
      data-dragging={isDragging || undefined}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        backgroundColor: color,
        borderRadius: '4px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        outline: isSelected ? '2px solid #2196F3' : 'none',
        outlineOffset: '2px',
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        zIndex: note.z,
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {isEditing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textDivRef}
          data-testid="sticky-text-display"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px',
            boxSizing: 'border-box',
            overflow: 'hidden',
            fontSize: `${fontPx}px`,
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'sans-serif',
            lineHeight: 1.2,
          }}
        >
          {note.text}
        </div>
      )}

      {overflow && !isEditing && (
        <div
          data-testid="sticky-overflow-fade"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '30px',
            background: `linear-gradient(transparent, ${color})`,
            pointerEvents: 'none',
            borderRadius: '0 0 4px 4px',
          }}
        />
      )}

      {isSelected && !isEditing && !isDragging && (
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
