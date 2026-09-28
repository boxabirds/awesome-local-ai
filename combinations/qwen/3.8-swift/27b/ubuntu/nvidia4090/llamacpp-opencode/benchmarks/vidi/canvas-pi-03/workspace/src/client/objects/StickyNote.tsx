import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from 'src/shared/board-model';
import { moveObject, bringToFront, getStickyText } from 'src/shared/board-model';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
} from 'src/shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

/** Padding (world units) shared by display text and the editor textarea. */
export const STICKY_NOTE_PADDING = 12;

const SELECTION_OUTLINE = '#1A73E8';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  /** Called when this note starts/stops being dragged (hides the note toolbar). */
  onDragChange?: (dragging: boolean) => void;
}

interface DragState {
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
  lastClientX: number;
  lastClientY: number;
  lastAppliedX: number;
  lastAppliedY: number;
  raf: number;
  dragging: boolean;
}

/**
 * One sticky note: renders at world (x, y) in the world layer and handles
 * select, drag-to-move, and text editing per the sticky.interaction contract.
 *
 * Interaction state per note (local, never stored in the doc):
 * Unselected → Pressed (pointerdown) → Selected (up) or Dragging (≥ threshold)
 * → Selected (up/cancel); Selected → Editing (dblclick / Enter) → Selected
 * (Escape) / Unselected (click outside).
 */
export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit, onDragChange } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  const ytext = getStickyText(doc, note.id);

  // Font fit: run on text change and on mount only (zoom scales world units
  // uniformly). The display div is always mounted so it can measure even
  // while the editor is showing.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setFit(fitFontSize(el, STICKY_SIZE_WORLD));
  }, [note.text]);

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    if (d.raf) {
      cancelAnimationFrame(d.raf);
      d.raf = 0;
      // Apply the final position synchronously so the note ends exactly where
      // the pointer was when released (a drag shorter than one frame still
      // moves the note by the delta).
      const nx = d.origX + (d.lastClientX - d.startClientX) / zoom;
      const ny = d.origY + (d.lastClientY - d.startClientY) / zoom;
      if (!(nx === d.lastAppliedX && ny === d.lastAppliedY)) {
        d.lastAppliedX = nx;
        d.lastAppliedY = ny;
        moveObject(doc, note.id, nx, ny); // false if deleted meanwhile: fine
      }
    }
    dragRef.current = null;
    onDragChange?.(false);
  }, [onDragChange, zoom, doc, note.id]);

  // Clean up on unmount only (e.g. note deleted mid-drag, TC-37).
  // Deliberately empty deps: re-running this on re-render would cancel an
  // in-progress drag (the note re-renders on every position update).
  useEffect(() => {
    return () => {
      const d = dragRef.current;
      if (d) {
        if (d.raf) cancelAnimationFrame(d.raf);
        dragRef.current = null;
      }
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editing) return;
    // The board must not pan while a note is pressed (sticky.no_pan).
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: note.x,
      origY: note.y,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      lastAppliedX: note.x,
      lastAppliedY: note.y,
      raf: 0,
      dragging: false,
    };
    onSelect(note.id);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;

    if (!d.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      d.dragging = true;
      // The note under the pointer comes to the front, once at drag start.
      bringToFront(doc, note.id);
      onDragChange?.(true);
    }

    d.lastClientX = e.clientX;
    d.lastClientY = e.clientY;
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        d.raf = 0;
        const nx = d.origX + (d.lastClientX - d.startClientX) / zoom;
        const ny = d.origY + (d.lastClientY - d.startClientY) / zoom;
        if (nx === d.lastAppliedX && ny === d.lastAppliedY) return;
        d.lastAppliedX = nx;
        d.lastAppliedY = ny;
        const ok = moveObject(doc, note.id, nx, ny);
        if (!ok) endDrag(); // note deleted meanwhile: end silently (TC-37)
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      endDrag();
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    // Pointer released outside the window / system interruption:
    // the note stays where it was last shown.
    if (dragRef.current) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      endDrag();
    }
  };

  const handleDblClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Dblclick on a note edits it; the board must not create a new note.
    e.stopPropagation();
    if (!editing) onStartEdit(note.id);
  };

  const color = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected || undefined}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: color,
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        borderRadius: 2,
        outline: selected ? `2px solid ${SELECTION_OUTLINE}` : 'none',
        outlineOffset: -1,
        cursor: editing ? 'text' : 'move',
        zIndex: note.z,
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onDoubleClick={handleDblClick}
      onFocus={() => {
        if (!selected) onSelect(note.id);
      }}
    >
      {/* Display text — always mounted so it can measure the fit, even while editing. */}
      <div
        ref={textRef}
        data-testid="sticky-note-text"
        style={{
          position: 'absolute',
          inset: 0,
          padding: STICKY_NOTE_PADDING,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          fontSize: fit.fontPx,
          lineHeight: 1.2,
          color: 'rgba(0,0,0,0.8)',
          visibility: editing ? 'hidden' : 'visible',
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>
      {fit.overflow && !editing && (
        <div
          data-testid="sticky-note-fade"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: STICKY_NOTE_PADDING * 2,
            background: `linear-gradient(to top, ${color} 0%, transparent 100%)`,
            pointerEvents: 'none',
          }}
        />
      )}
      {editing && ytext && (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      )}
    </div>
  );
}
