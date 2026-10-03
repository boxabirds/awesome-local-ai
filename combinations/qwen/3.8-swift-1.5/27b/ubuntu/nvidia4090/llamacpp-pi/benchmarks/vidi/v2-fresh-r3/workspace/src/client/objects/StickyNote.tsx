import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import type { StickySnapshot } from '../../shared/board-model';
import { moveObject, bringToFront, setStickyColor, deleteObject, getStickyText } from '../../shared/board-model';
import { fitFontSize, STICKY_TEXT_PADDING } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

const TEXT_BOX = STICKY_SIZE_WORLD - STICKY_TEXT_PADDING * 2;
const SELECTION_OUTLINE = '2px solid #1A73E8';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

interface DragState {
  pointerId: number;
  startScreen: { x: number; y: number };
  startWorld: { x: number; y: number };
  lastWorld: { x: number; y: number };
  moved: boolean;
  raf: number | null;
}

/**
 * One sticky note in the world layer. Handles select (short press), drag to
 * move (beyond DRAG_THRESHOLD_PX, at any zoom), and text editing
 * (dblclick / Enter). pointerdown stops propagation so the viewport never
 * pans while a note is dragged. If the note disappears mid-interaction the
 * interaction ends silently (the parent unmounts this component).
 */
export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;
  const textRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Auto-fit the display text on mount and on text change only (zoom scales
  // uniformly, so no refit is needed on zoom).
  useEffect(() => {
    if (editing) return;
    const el = textRef.current;
    if (!el) return;
    const fit = fitFontSize(el, TEXT_BOX);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [note.text, editing]);

  // Cancel any pending rAF if the note is unmounted mid-drag (deleted
  // meanwhile): the interaction ends silently at the last shown position.
  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (drag && drag.raf !== null) cancelAnimationFrame(drag.raf);
    },
    [],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return; // the textarea handles pointers while editing
    e.stopPropagation(); // dragging a note never pans the board
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startWorld: { x: note.x, y: note.y },
      lastWorld: { x: note.x, y: note.y },
      moved: false,
      raf: null,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();

    const dx = e.clientX - drag.startScreen.x;
    const dy = e.clientY - drag.startScreen.y;

    if (!drag.moved) {
      // A short press without movement stays Pressed; moving more than a few
      // pixels starts a drag.
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragging(true);
      // The note under the pointer comes to the front (once per drag).
      bringToFront(doc, note.id);
    }

    // Divide by the camera zoom so the grabbed point stays under the pointer
    // at any zoom level.
    drag.lastWorld = {
      x: drag.startWorld.x + dx / zoom,
      y: drag.startWorld.y + dy / zoom,
    };
    // Throttle writes to one per animation frame.
    if (drag.raf === null) {
      drag.raf = requestAnimationFrame(() => {
        const d = dragRef.current;
        if (!d || d.raf === null) return;
        d.raf = null;
        moveObject(doc, note.id, d.lastWorld.x, d.lastWorld.y);
      });
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    if (drag.raf !== null) {
      cancelAnimationFrame(drag.raf);
      drag.raf = null;
      if (!cancelled) {
        // Flush the final position so the grabbed point is exactly under the
        // pointer on release (moveObject is a no-op for a stale id).
        moveObject(doc, note.id, drag.lastWorld.x, drag.lastWorld.y);
      }
    }
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be gone (pointercancel)
    }
    onSelect(note.id);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    finishDrag(e, false);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    // A cancelled drag keeps the last applied position.
    finishDrag(e, true);
  };

  const handleLostPointerCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) handlePointerCancel(e);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // a double-click on a note edits it, never creates
    if (editing) return;
    onStartEdit(note.id);
  };

  const handleDelete = () => {
    if (deleteObject(doc, note.id)) {
      onSelect(null);
    }
  };

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      data-selected={selected}
      data-dragging={dragging || undefined}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[note.color],
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        outline: selected ? SELECTION_OUTLINE : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        boxSizing: 'border-box',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
    >
      {editing ? (
        <StickyTextEditor ytext={getStickyText(doc, note.id)!} fontPx={fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textRef}
          data-testid="sticky-text"
          className={overflow ? 'sticky-text sticky-fade' : 'sticky-text'}
          style={{
            position: 'absolute',
            inset: 0,
            padding: STICKY_TEXT_PADDING,
            boxSizing: 'border-box',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            display: 'flex',
            alignItems: overflow ? 'flex-start' : 'center',
            justifyContent: 'center',
            textAlign: 'center',
            color: '#222',
            fontFamily: 'system-ui, sans-serif',
            fontSize: fontPx,
            lineHeight: 1.2,
            pointerEvents: 'none',
          }}
        >
          {note.text}
        </div>
      )}

      {overflow && !editing && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 48,
            background: `linear-gradient(to bottom, transparent, ${STICKY_COLORS[note.color]})`,
            pointerEvents: 'none',
          }}
        />
      )}

      {selected && !editing && !dragging && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            transform: `translate(-50%, calc(-100% - 6px)) scale(${1 / zoom})`,
            transformOrigin: 'bottom center',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c) => {
              setStickyColor(doc, note.id, c);
            }}
            onDelete={handleDelete}
          />
        </div>
      )}
    </div>
  );
}
