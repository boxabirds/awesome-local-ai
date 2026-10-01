// src/client/objects/StickyNote.tsx
import { useCallback, useRef, useEffect, useState } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import { moveObject, bringToFront, getStickyText, setStickyColor, deleteObject } from '../../shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DRAG_THRESHOLD_PX, STICKY_FONT_MAX_PX, type StickyColor } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
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

export function StickyNote(props: StickyNoteProps): ReactElement {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;
  const elRef = useRef<HTMLDivElement>(null);
  const [interaction, setInteraction] = useState<InteractionState>('unselected');
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  // Drag state refs
  const dragStartRef = useRef<{ screenX: number; screenY: number; worldX: number; worldY: number } | null>(null);
  const rafRef = useRef<number>(0);
  const lastMoveRef = useRef<{ x: number; y: number } | null>(null);

  // Fit font size when text changes
  useEffect(() => {
    const el = elRef.current?.querySelector('[data-sticky-text]');
    if (el && !editing) {
      const result = fitFontSize(el as HTMLElement, STICKY_SIZE_WORLD);
      setFontPx(result.fontPx);
      setOverflow(result.overflow);
    }
  }, [note.text, editing]);

  // If the note is deleted from the doc, end interaction silently
  useEffect(() => {
    if (interaction === 'dragging') {
      const objects = doc.getMap('objects');
      if (!objects.has(note.id)) {
        setInteraction('unselected');
        dragStartRef.current = null;
        lastMoveRef.current = null;
      }
    }
  }, [doc, note.id, interaction]);

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    if (editing) return;
    e.stopPropagation(); // Prevent board pan
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setInteraction('pressed');
    dragStartRef.current = {
      screenX: e.clientX,
      screenY: e.clientY,
      worldX: note.x,
      worldY: note.y,
    };
    lastMoveRef.current = null;
  }, [editing, note.x, note.y]);

  const handlePointerMove = useCallback((e: ReactPointerEvent) => {
    if (interaction === 'unselected') return;
    const start = dragStartRef.current;
    if (!start) return;

    const dx = e.clientX - start.screenX;
    const dy = e.clientY - start.screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (interaction === 'pressed' && dist >= DRAG_THRESHOLD_PX) {
      // Start dragging
      setInteraction('dragging');
      bringToFront(doc, note.id);
    }

    if (interaction === 'dragging' || dist >= DRAG_THRESHOLD_PX) {
      const newWorldX = start.worldX + dx / zoom;
      const newWorldY = start.worldY + dy / zoom;
      lastMoveRef.current = { x: newWorldX, y: newWorldY };

      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          if (lastMoveRef.current) {
            moveObject(doc, note.id, lastMoveRef.current.x, lastMoveRef.current.y);
          }
        });
      }
    }
  }, [interaction, doc, note.id, zoom]);

  const handlePointerUp = useCallback((e: ReactPointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* already released */ }

    if (interaction === 'pressed') {
      // Was just a click - select
      setInteraction('unselected');
      onSelect(note.id);
    } else if (interaction === 'dragging') {
      setInteraction('unselected');
      // Already selected (or was selected before drag)
      onSelect(note.id);
    }
    dragStartRef.current = null;
    lastMoveRef.current = null;
  }, [interaction, note.id, onSelect]);

  const handlePointerCancel = useCallback(() => {
    if (interaction === 'dragging') {
      // Keep last applied position
      setInteraction('unselected');
      onSelect(note.id);
    } else if (interaction === 'pressed') {
      setInteraction('unselected');
    }
    dragStartRef.current = null;
    lastMoveRef.current = null;
  }, [interaction, note.id, onSelect]);

  const handleLostPointerCapture = useCallback(() => {
    if (interaction === 'dragging') {
      setInteraction('unselected');
      onSelect(note.id);
    } else if (interaction === 'pressed') {
      setInteraction('unselected');
    }
    dragStartRef.current = null;
    lastMoveRef.current = null;
  }, [interaction, note.id, onSelect]);

  const handleDblClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editing) {
      onStartEdit(note.id);
    }
  }, [editing, note.id, onStartEdit]);

  // Get the Y.Text for this note
  const ytext = getStickyText(doc, note.id);

  const isDragging = interaction === 'dragging';

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Sticky note"
      data-selected={selected || undefined}
      data-testid={`sticky-note-${note.id}`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDblClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[note.color],
        borderRadius: 2,
        boxShadow: '2px 2px 8px rgba(0,0,0,0.2)',
        outline: selected ? '3px solid #2196F3' : 'none',
        outlineOffset: 2,
        cursor: isDragging ? 'grabbing' : 'grab',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          data-sticky-text
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
            fontSize: fontPx,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'center',
            overflow: 'hidden',
            position: 'relative',
            borderRadius: 2,
          }}
        >
          {note.text}
          {overflow && (
            <div
              className="sticky-fade"
              data-testid="sticky-fade"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 30,
                background: `linear-gradient(transparent, ${STICKY_COLORS[note.color]})`,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      )}

      {/* Note toolbar: shown when selected, not editing, not dragging */}
      {selected && !editing && !isDragging && (
        <div
          style={{
            position: 'absolute',
            top: -40,
            left: '50%',
            transform: `translateX(-50%) scale(${1 / zoom})`,
            transformOrigin: 'bottom center',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c: StickyColor) => setStickyColor(doc, note.id, c)}
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
