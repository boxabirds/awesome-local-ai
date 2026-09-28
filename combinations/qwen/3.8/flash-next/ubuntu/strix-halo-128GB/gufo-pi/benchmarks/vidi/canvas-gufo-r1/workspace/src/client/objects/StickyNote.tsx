import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import { bringToFront, getStickyText, moveObject } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_SIZE_WORLD } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

type NoteState = 'unselected' | 'pressed' | 'selected' | 'dragging' | 'editing';

export function StickyNote(props: StickyNoteProps) {
  const { note, doc, zoom, selected, editing, editable = true, onSelect, onStartEdit, onEndEdit } = props;
  const elRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(24);
  const [overflow, setOverflow] = useState(false);
  const [dragZ, setDragZ] = useState(false);

  // Drag state refs (avoid re-renders during drag)
  const dragRef = useRef<{
    startScreenX: number;
    startScreenY: number;
    startNoteX: number;
    startNoteY: number;
    moved: boolean;
  } | null>(null);
  const stateRef = useRef<NoteState>(editing ? 'editing' : selected ? 'selected' : 'unselected');
  const rafRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);

  // Sync state from props
  useEffect(() => {
    if (editing) {
      stateRef.current = 'editing';
    } else if (selected) {
      if (stateRef.current === 'editing') {
        stateRef.current = 'selected';
      }
    } else {
      if (stateRef.current !== 'dragging' && stateRef.current !== 'pressed') {
        stateRef.current = 'unselected';
      }
    }
  }, [selected, editing]);

  // Fit font size on text change
  useEffect(() => {
    if (!textRef.current) return;
    const result = fitFontSize(textRef.current, STICKY_SIZE_WORLD);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [note.text]);

  // End interaction if note disappears from doc
  useEffect(() => {
    const observe = () => {
      const ytext = getStickyText(doc, note.id);
      if (!ytext) {
        // Note was deleted; end interaction
        stateRef.current = 'unselected';
        dragRef.current = null;
      }
    };
    const objectsMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    objectsMap.observe(observe);
    return () => { objectsMap.unobserve(observe); };
  }, [doc, note.id]);

  const flushDrag = useCallback(() => {
    rafRef.current = null;
    const pos = pendingPosRef.current;
    if (!pos) return;
    pendingPosRef.current = null;
    const result = moveObject(doc, note.id, pos.x, pos.y);
    if (!result) {
      // Note was deleted; stop drag
      stateRef.current = 'unselected';
      dragRef.current = null;
    }
  }, [doc, note.id]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      if (editing || !editable) return;

      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // jsdom
      }

      dragRef.current = {
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startNoteX: note.x,
        startNoteY: note.y,
        moved: false,
      };
      stateRef.current = 'pressed';
    },
    [editing, editable, note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = e.clientX - drag.startScreenX;
      const dy = e.clientY - drag.startScreenY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (stateRef.current === 'pressed') {
        if (dist >= DRAG_THRESHOLD_PX) {
          // Transition to dragging
          stateRef.current = 'dragging';
          drag.moved = true;
          // Use local state z-index instead of model bringToFront to avoid
          // React DOM reordering which releases pointer capture
          setDragZ(true);
        }
      }

      if (stateRef.current === 'dragging') {
        const worldDx = dx / zoom;
        const worldDy = dy / zoom;
        pendingPosRef.current = {
          x: drag.startNoteX + worldDx,
          y: drag.startNoteY + worldDy,
        };
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(flushDrag);
        }
      }
    },
    [doc, note.id, zoom, flushDrag],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      const drag = dragRef.current;
      if (!drag) return;

      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // jsdom
      }

      // Flush any pending position
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (pendingPosRef.current) {
        moveObject(doc, note.id, pendingPosRef.current.x, pendingPosRef.current.y);
        pendingPosRef.current = null;
      }

      if (!drag.moved) {
        // It was a click (no drag)
        onSelect(note.id);
        stateRef.current = 'selected';
      } else {
        // Bring to front after drag completes (avoids DOM reorder during drag)
        bringToFront(doc, note.id);
        setDragZ(false);
        stateRef.current = 'selected';
      }
      dragRef.current = null;
    },
    [doc, note.id, onSelect],
  );

  const handlePointerCancel = useCallback(
    (_e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Flush pending position one last time
      if (pendingPosRef.current) {
        moveObject(doc, note.id, pendingPosRef.current.x, pendingPosRef.current.y);
        pendingPosRef.current = null;
      }

      stateRef.current = 'selected';
      dragRef.current = null;
    },
    [doc, note.id],
  );

  const handleDblClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!editable) return;
      onSelect(note.id);
      onStartEdit(note.id);
    },
    [note.id, onSelect, onStartEdit, editable],
  );

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      stateRef.current = next === 'selected' ? 'selected' : 'unselected';
      onEndEdit(next);
    },
    [onEndEdit],
  );

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const bgColor = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;

  return (
    <div
      ref={elRef}
      className={`sticky-note${selected ? ' sticky-selected' : ''}${overflow ? ' sticky-overflow' : ''}`}
      data-testid={`sticky-note-${note.id}`}
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: bgColor,
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        outline: selected ? '2px solid #2563eb' : 'none',
        outlineOffset: -2,
        cursor: editing ? 'text' : 'grab',
        overflow: 'hidden',
        zIndex: dragZ ? 10000 : note.z,
        userSelect: editing ? 'text' : 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onDoubleClick={handleDblClick}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx}
          onEnd={handleEndEdit}
        />
      ) : (
        <div
          ref={textRef}
          className="sticky-note-text"
          style={{
            fontSize: fontPx,
            padding: '12px',
            width: '100%',
            height: '100%',
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {note.text}
        </div>
      )}
      {overflow && <div className="sticky-fade" data-testid="sticky-fade" />}
    </div>
  );
}
