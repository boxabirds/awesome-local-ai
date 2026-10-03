import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
  type StickyColor,
} from '../../shared/config';
import { moveObject, bringToFront, getStickyText, setStickyColor, deleteObject, type StickySnapshot } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

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

type InteractionState = 'idle' | 'pressed' | 'dragging';

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;
  const noteRef = useRef<HTMLDivElement>(null);
  const [interaction, setInteraction] = useState<InteractionState>('idle');

  // Drag state refs
  const dragStartRef = useRef<{ screenX: number; screenY: number; worldX: number; worldY: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const broughtToFrontRef = useRef(false);

  // Font fit
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  // Re-fit font when text changes
  useEffect(() => {
    const el = noteRef.current?.querySelector('.sticky-text-display') as HTMLElement | null;
    if (!el) return;
    const result = fitFontSize(el, STICKY_SIZE_WORLD - 16); // 8px padding each side
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [note.text]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const flushMove = useCallback(() => {
    rafRef.current = null;
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (!pending) return;
    moveObject(doc, note.id, pending.x, pending.y);
  }, [doc, note.id]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // Don't let the board pan

      const el = noteRef.current;
      if (!el) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // jsdom may not support pointer capture
      }

      dragStartRef.current = {
        screenX: e.clientX,
        screenY: e.clientY,
        worldX: note.x,
        worldY: note.y,
      };
      broughtToFrontRef.current = false;
      setInteraction('pressed');
    },
    [note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start) return;

      const dx = e.clientX - start.screenX;
      const dy = e.clientY - start.screenY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (interaction === 'pressed') {
        if (distance >= DRAG_THRESHOLD_PX) {
          setInteraction('dragging');
          if (!broughtToFrontRef.current) {
            bringToFront(doc, note.id);
            broughtToFrontRef.current = true;
          }
        } else {
          return; // Below threshold
        }
      }

      if (interaction === 'dragging' || distance >= DRAG_THRESHOLD_PX) {
        const newWorldX = start.worldX + dx / zoom;
        const newWorldY = start.worldY + dy / zoom;
        pendingMoveRef.current = { x: newWorldX, y: newWorldY };
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(flushMove);
        }
      }
    },
    [interaction, doc, note.id, zoom, flushMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = noteRef.current;
      if (el) {
        try {
          if (el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore
        }
      }

      // Flush any pending move
      if (pendingMoveRef.current) {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        flushMove();
      }

      dragStartRef.current = null;
      setInteraction('idle');
      onSelect(note.id);
    },
    [note.id, flushMove, onSelect],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = noteRef.current;
      if (el) {
        try {
          if (el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore
        }
      }

      if (pendingMoveRef.current) {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        flushMove();
      }

      dragStartRef.current = null;
      setInteraction('idle');
      onSelect(note.id);
    },
    [note.id, flushMove, onSelect],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onStartEdit(note.id);
    },
    [note.id, onStartEdit],
  );

  const handleColorChange = useCallback(
    (c: StickyColor) => {
      setStickyColor(doc, note.id, c);
    },
    [doc, note.id],
  );

  const handleDelete = useCallback(() => {
    deleteObject(doc, note.id);
    onSelect(null);
  }, [doc, note.id, onSelect]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const isDragging = interaction === 'dragging';

  return (
    <div
      ref={noteRef}
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}${overflow ? ' sticky-note--overflow' : ''}`}
      role="group"
      aria-label="Sticky note"
      data-vidi6="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        backgroundColor: STICKY_COLORS[note.color],
        zIndex: note.z,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          className="sticky-text-display"
          style={{ fontSize: `${fontPx}px` }}
          data-vidi6="sticky-text-display"
        >
          {note.text}
        </div>
      )}

      {selected && !isDragging && !editing && (
        <NoteToolbar
          color={note.color}
          onColor={handleColorChange}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
