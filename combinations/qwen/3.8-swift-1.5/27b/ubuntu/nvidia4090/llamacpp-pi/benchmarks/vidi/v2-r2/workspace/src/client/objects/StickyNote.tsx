import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import { bringToFront, deleteObject, getStickyText, moveObject, setStickyColor } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  DRAG_THRESHOLD_PX,
  type StickyColor,
} from '../../shared/config';

const TEXT_PADDING = 16;

interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Stacking order (CSS zIndex); the DOM order is kept stable. */
  z: number;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * When false (board cannot be loaded) all mutating interactions are
   * no-ops: drag, text editing, colour and delete (story 4). Selection and
   * viewing remain possible.
   */
  editable?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startNoteX: number;
  startNoteY: number;
  lastClientX: number;
  lastClientY: number;
  dragging: boolean;
  raf: number | null;
}

/**
 * A sticky note: render, select, drag, edit.
 *
 * Per-note interaction states (never stored in the doc):
 * Unselected → Pressed (pointerdown) → Selected (pointerup within threshold)
 *             → Dragging (movement ≥ DRAG_THRESHOLD_PX) → Selected (pointerup/cancel)
 * Selected/Unselected → Editing (dblclick or Enter) → Selected (Escape) / Unselected (click outside)
 */
export function StickyNote({
  note,
  doc,
  z,
  zoom,
  selected,
  editing,
  editable = true,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps) {
  const noteElRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // Font auto-fit: largest size in [MIN, MAX] board units at which the text
  // fits; runs on text change and mount (zoom scales everything uniformly).
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setFit(fitFontSize(el, STICKY_SIZE_WORLD - 2 * TEXT_PADDING));
  }, [note.text, editing]);

  const applyDragPosition = useCallback(
    (st: DragState) => {
      const dx = st.lastClientX - st.startClientX;
      const dy = st.lastClientY - st.startClientY;
      if (dx === 0 && dy === 0) return true;
      // Divide by camera zoom so the grabbed point stays under the pointer.
      return moveObject(doc, note.id, st.startNoteX + dx / zoom, st.startNoteY + dy / zoom);
    },
    [doc, note.id, zoom]
  );

  const endDrag = useCallback(
    (st: DragState) => {
      if (st.raf !== null) cancelAnimationFrame(st.raf);
      if (st.dragging) {
        // Flush the last frame so the note stays where it was last shown.
        applyDragPosition(st);
        // If moveObject returned false the note was deleted mid-drag: the
        // component unmounts and the interaction ends silently (TC-37).
      }
      dragRef.current = null;
      setDragging(false);
      try {
        noteElRef.current?.releasePointerCapture(st.pointerId);
      } catch {
        // jsdom / already released
      }
    },
    [applyDragPosition]
  );

  // If the note is deleted mid-interaction the component unmounts: release
  // capture and cancel any pending frame.
  useEffect(() => {
    return () => {
      const st = dragRef.current;
      if (!st) return;
      if (st.raf !== null) cancelAnimationFrame(st.raf);
      dragRef.current = null;
      try {
        noteElRef.current?.releasePointerCapture(st.pointerId);
      } catch {
        // ignore
      }
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    // Never let the viewport pan or clear the selection on a note press.
    e.stopPropagation();
    if (editing) return;
    try {
      noteElRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // jsdom doesn't support pointer capture
    }
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startNoteX: note.x,
      startNoteY: note.y,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      dragging: false,
      raf: null,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragRef.current;
    if (!st || e.pointerId !== st.pointerId) return;
    // View-only (board load failed): a press may still select the note on
    // release, but it never drags.
    if (!editable) return;
    const dx = e.clientX - st.startClientX;
    const dy = e.clientY - st.startClientY;
    if (!st.dragging) {
      // Below the threshold: stays Pressed (a short press selects on release).
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      st.dragging = true;
      setDragging(true);
      // Come to the front once, so the note is drawn above anything it overlaps.
      bringToFront(doc, note.id);
    }
    st.lastClientX = e.clientX;
    st.lastClientY = e.clientY;
    if (st.raf === null) {
      st.raf = requestAnimationFrame(() => {
        const s = dragRef.current;
        if (!s) return;
        s.raf = null;
        if (!s.dragging) return;
        applyDragPosition(s);
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragRef.current;
    if (!st || e.pointerId !== st.pointerId) return;
    endDrag(st);
    // Pressed or Dragging → Selected.
    onSelect(note.id);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragRef.current;
    if (!st || e.pointerId !== st.pointerId) return;
    endDrag(st);
    // Pointercancel → Selected at the last applied position.
    onSelect(note.id);
  };

  const handleLostPointerCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragRef.current;
    if (!st || e.pointerId !== st.pointerId) return;
    endDrag(st);
    onSelect(note.id);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editable) return;
    onStartEdit(note.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Tab-reachable notes are editable with Enter (accessibility).
    if (e.key === 'Enter' && !editing && editable) {
      e.preventDefault();
      onStartEdit(note.id);
    }
  };

  const background = STICKY_COLORS[note.color] ?? STICKY_COLORS[DEFAULT_FALLBACK];
  const ytext = getStickyText(doc, note.id);

  return (
    <div
      ref={noteElRef}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected || undefined}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        zIndex: z,
        boxSizing: 'border-box',
        background,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        outline: selected ? '2px solid #2563eb' : 'none',
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : (
        <>
          <div
            ref={textRef}
            data-testid="sticky-text"
            style={{
              position: 'absolute',
              inset: 0,
              boxSizing: 'border-box',
              padding: TEXT_PADDING,
              overflow: 'hidden',
              display: 'flex',
              alignItems: fit.overflow ? 'flex-start' : 'center',
              justifyContent: 'center',
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: `${fit.fontPx}px`,
              lineHeight: 1.2,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: '#333',
              pointerEvents: 'none',
            }}
          >
            {note.text}
          </div>
          {fit.overflow && (
            <div
              data-testid="sticky-fade"
              className="sticky-fade"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 28,
                background: `linear-gradient(to bottom, rgba(0,0,0,0), ${background})`,
                pointerEvents: 'none',
              }}
            />
          )}
        </>
      )}
      {!editing && !dragging && selected && editable && (
        // Screen-space toolbar: counter-scaled by 1/zoom so it does not grow
        // with board zoom. Anchored at the note's top centre. Hidden when the
        // board cannot be loaded (colour + delete would be unstoreable).
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '100%',
            marginBottom: 6,
            transform: `translateX(-50%) scale(${1 / zoom})`,
            transformOrigin: 'bottom center',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c: StickyColor) => setStickyColor(doc, note.id, c)}
            onDelete={() => deleteObject(doc, note.id)}
          />
        </div>
      )}
    </div>
  );
}

const DEFAULT_FALLBACK: StickyColor = 'yellow';
