import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type * as Y from 'yjs';

import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import {
  bringToFront,
  getStickyText,
  moveObject,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { stickyContentBox, StickyTextEditor } from './StickyTextEditor';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onDraggingChange?(dragging: boolean): void;
}

type DragState = 'idle' | 'pressed' | 'dragging';

/**
 * One sticky note in the world layer. Renders the note, and owns the local
 * interaction state machine (Unselected → Pressed → Selected / Dragging →
 * Editing). Selection/editing state lives in the parent (`useSelection`); only
 * the drag state is internal. All mutations go through the board model.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
  onDraggingChange,
}: StickyNoteProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const noteIdRef = useRef(note.id);
  noteIdRef.current = note.id;
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;

  const dragState = useRef<DragState>('idle');
  const start = useRef<{ sx: number; sy: number; wx: number; wy: number } | null>(null);
  const latest = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);

  // Auto-fit the display text (largest size 24..10px at which it fits).
  useLayoutEffect(() => {
    if (editing) return;
    const el = textRef.current;
    if (!el) return;
    const result = fitFontSize(el, stickyContentBox(el));
    setOverflow(result.overflow);
  }, [note.text, editing]);

  const cancelFrame = () => {
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  };

  const endDrag = () => {
    cancelFrame();
    const wasDragging = dragState.current === 'dragging';
    dragState.current = 'idle';
    start.current = null;
    latest.current = null;
    if (wasDragging) onDraggingChangeRef.current?.(false);
    // A press that never became a drag still selects the note.
    onSelect(noteIdRef.current);
  };

  // The note disappearing mid-drag unmounts this component: drop the frame.
  useEffect(() => cancelFrame, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (editing) return; // the textarea owns events while editing
    event.stopPropagation(); // the board must not pan (sticky.no_pan)
    dragState.current = 'pressed';
    start.current = {
      sx: event.clientX,
      sy: event.clientY,
      wx: note.x,
      wy: note.y,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events may not support capture; dragging still works */
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current === 'idle') return;
    const s = start.current;
    if (!s) return;
    const dx = event.clientX - s.sx;
    const dy = event.clientY - s.sy;

    if (dragState.current === 'pressed') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragState.current = 'dragging';
      bringToFront(doc, noteIdRef.current);
      onDraggingChangeRef.current?.(true);
    }
    // Divide the screen delta by zoom so the grabbed point stays under the
    // pointer at any zoom level.
    const z = zoomRef.current || 1;
    latest.current = { x: s.wx + dx / z, y: s.wy + dy / z };
    if (rafRef.current === 0) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const p = latest.current;
        if (!p) return;
        // moveObject returns false if the note was deleted mid-drag → end.
        if (!moveObject(doc, noteIdRef.current, p.x, p.y)) {
          endDrag();
        }
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current === 'idle') return;
    event.stopPropagation();
    endDrag();
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current === 'idle') return;
    event.stopPropagation();
    // Keep the last applied position (sticky.move / Drag interrupted).
    endDrag();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Editing this note, never creating a new one (sticky.edit_start).
    event.stopPropagation();
    onStartEdit(note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragState.current === 'dragging' ? 'true' : 'false'}
      className="sticky-note"
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: STICKY_COLORS[note.color],
        zIndex: note.z,
        ['--sticky-padding' as string]: `${STICKY_PADDING_WORLD}px`,
      } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        if (!editing) onSelect(note.id);
      }}
      onDragStart={(event) => event.preventDefault()}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={STICKY_FONT_MAX_PX} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textRef}
          className={`sticky-note__text${overflow ? ' has-overflow' : ''}`}
          data-testid={`sticky-text-${note.id}`}
        >
          <div className="sticky-note__label">{note.text}</div>
        </div>
      )}
    </div>
  );
}
