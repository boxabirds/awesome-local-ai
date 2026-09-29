import { useRef, useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { StickySnapshot, moveObject, bringToFront, getStickyText } from '@shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DRAG_THRESHOLD_PX, STICKY_FONT_MAX_PX } from '@shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';


interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
}

type InteractionState = 'unselected' | 'pressed' | 'dragging';

export function StickyNote({ note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit }: StickyNoteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<InteractionState>('unselected');
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; noteX: number; noteY: number } | null>(null);
  const rafRef = useRef<number>(0);
  const lastMoveRef = useRef<{ x: number; y: number } | null>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  // Fit font size when text changes - uses the hidden measurement element
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    // Update the measurement element's text
    el.textContent = note.text;
    const { fontPx: fitted, overflow: ovf } = fitFontSize(el, STICKY_SIZE_WORLD - 32);
    setFontPx(fitted);
    setOverflow(ovf);
  }, [note.text]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing) return;
    
    stateRef.current = 'pressed';
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      noteX: note.x,
      noteY: note.y,
    };
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      // jsdom doesn't support setPointerCapture
    }
    onSelect(note.id);
  }, [note.id, note.x, note.y, editing, onSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (stateRef.current !== 'pressed' && stateRef.current !== 'dragging') return;
    if (!dragStartRef.current) return;

    const dx = e.clientX - dragStartRef.current.pointerX;
    const dy = e.clientY - dragStartRef.current.pointerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (stateRef.current === 'pressed' && dist < DRAG_THRESHOLD_PX) return;

    if (stateRef.current === 'pressed') {
      // Transition to dragging
      stateRef.current = 'dragging';
      bringToFront(doc, note.id);
    }

    // Compute new world position
    const newX = dragStartRef.current.noteX + dx / zoom;
    const newY = dragStartRef.current.noteY + dy / zoom;
    lastMoveRef.current = { x: newX, y: newY };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (lastMoveRef.current) {
        moveObject(doc, note.id, lastMoveRef.current.x, lastMoveRef.current.y);
      }
    });
  }, [doc, note.id, zoom]);

  const endDrag = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (lastMoveRef.current) {
      moveObject(doc, note.id, lastMoveRef.current.x, lastMoveRef.current.y);
      lastMoveRef.current = null;
    }
    stateRef.current = 'unselected';
    dragStartRef.current = null;
  }, [doc, note.id]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (stateRef.current === 'dragging') {
      endDrag();
    } else if (stateRef.current === 'pressed') {
      // Was a click (no drag)
      stateRef.current = 'unselected';
      dragStartRef.current = null;
    }
    try {
      ref.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, [endDrag]);

  const handlePointerCancel = useCallback(() => {
    if (stateRef.current === 'dragging') {
      endDrag();
    } else {
      stateRef.current = 'unselected';
      dragStartRef.current = null;
    }
  }, [endDrag]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStartEdit(note.id);
  }, [note.id, onStartEdit]);

  // Clean up rAF on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const color = STICKY_COLORS[note.color] || STICKY_COLORS.yellow;
  const ytext = getStickyText(doc, note.id);

  return (
    <div
      ref={ref}
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
      onLostPointerCapture={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: color,
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        outline: selected ? '2px solid #2196F3' : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : 'grab',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: note.z,
      }}
    >
      {/* Hidden measurement element for font fitting - always present */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: STICKY_SIZE_WORLD - 32,
          height: STICKY_SIZE_WORLD - 32,
          padding: 0,
          margin: 0,
          fontSize: `${STICKY_FONT_MAX_PX}px`,
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      />
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          data-testid="sticky-text"
          className={overflow ? 'sticky-text-overflow' : ''}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            fontSize: `${fontPx}px`,
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {note.text}
          {overflow && (
            <div
              data-testid="text-fade"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 32,
                background: `linear-gradient(transparent, ${color})`,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
