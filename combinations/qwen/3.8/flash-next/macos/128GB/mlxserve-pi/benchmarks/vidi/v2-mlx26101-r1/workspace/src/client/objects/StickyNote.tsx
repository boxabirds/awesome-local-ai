import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import {
  bringToFront,
  getStickyText,
  moveObject,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** The per-note toolbar's colour/delete actions (wired by App). */
  onColor(color: string): void;
  onDelete(): void;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * False while the board could not be loaded: the note cannot be dragged or
   * opened for editing, so nothing writes into a document that has no board.
   */
  canEdit: boolean;
}

type DragState = 'idle' | 'pressed' | 'dragging';

/**
 * One sticky note rendered inside the world layer (so it scales with zoom). Owns
 * the local Unselected/Pressed/Selected/Dragging/Editing interaction state: a
 * click selects, a press that moves past DRAG_THRESHOLD_PX drags (bringing the
 * note to front and keeping the grabbed point under the pointer at any zoom), a
 * double-click edits. Pointer-down stops propagation so the board never pans when
 * a note is grabbed.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onColor,
  onDelete,
  onSelect,
  onStartEdit,
  onEndEdit,
  canEdit,
}: StickyNoteProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [displayFit, setDisplayFit] = useState({ fontPx: 24, overflow: false });
  // Whether a drag is in progress, mirrored into React state. `drag` is a ref (so
  // per-frame movement does not re-render), and the note's toolbar is hidden while
  // dragging: without this mirror nothing re-renders when the drag ends, and the
  // toolbar of a note that has just been moved would stay hidden.
  const [dragging, setDragging] = useState(false);

  // Drag bookkeeping lives in refs so per-frame movement does not re-render React;
  // the note's position comes from the document (note.x/note.y) via moveObject.
  const drag = useRef<{
    state: DragState;
    startClientX: number;
    startClientY: number;
    startWorldX: number;
    startWorldY: number;
    frame: number;
    pendingX: number;
    pendingY: number;
  }>({
    state: 'idle',
    startClientX: 0,
    startClientY: 0,
    startWorldX: 0,
    startWorldY: 0,
    frame: 0,
    pendingX: 0,
    pendingY: 0,
  });

  // Measure the display text and pick the largest font that fits the note.
  const measureDisplay = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    const box = el.clientHeight || el.offsetHeight;
    const result = fitFontSize(el, box);
    setDisplayFit((prev) =>
      prev.fontPx === result.fontPx && prev.overflow === result.overflow
        ? prev
        : result,
    );
  }, []);

  useLayoutEffect(() => {
    if (!editing) measureDisplay();
  }, [note.text, editing, measureDisplay]);

  // Flush any queued drag write on the next animation frame (rAF-throttled move).
  const flushDrag = useCallback(() => {
    const d = drag.current;
    d.frame = 0;
    if (d.state !== 'dragging') return;
    // moveObject returns false if the note was deleted mid-drag → end silently.
    if (!moveObject(doc, note.id, d.pendingX, d.pendingY)) {
      d.state = 'idle';
      setDragging(false);
    }
  }, [doc, note.id]);

  const endInteraction = useCallback(() => {
    const d = drag.current;
    if (d.frame) {
      cancelAnimationFrame(d.frame);
      d.frame = 0;
    }
    d.state = 'idle';
    setDragging(false);
  }, []);

  // If the note unmounts while dragging, stop the drag (stale-id safety).
  useEffect(() => () => endInteraction(), [endInteraction]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canEdit) return; // an unloadable board is not editable: no select, no drag
    if (editing) return; // the textarea owns input while editing
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Grabbing a note must never pan the board (sticky.no_pan).
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onSelect(note.id); // a short press selects; a drag keeps it selected
    const d = drag.current;
    d.state = 'pressed';
    d.startClientX = e.clientX;
    d.startClientY = e.clientY;
    // Snapshot the note's CURRENT world position so repeated grabs accumulate
    // from wherever the note rests now.
    d.startWorldX = note.x;
    d.startWorldY = note.y;
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.state === 'idle') return;
    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;

    if (d.state === 'pressed') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a possible click
      d.state = 'dragging';
      setDragging(true);
      bringToFront(doc, note.id); // drawn above anything it overlaps
    }

    // Divide the on-screen delta by zoom so the grabbed world point tracks the
    // pointer exactly at 50%, 100% and 200%.
    d.pendingX = d.startWorldX + dx / zoom;
    d.pendingY = d.startWorldY + dy / zoom;
    if (!d.frame) d.frame = requestAnimationFrame(flushDrag);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.state === 'idle') return;
    e.stopPropagation();
    // Commit any queued position, then settle as Selected.
    if (d.frame) {
      cancelAnimationFrame(d.frame);
      d.frame = 0;
      flushDrag();
    }
    d.state = 'idle';
    setDragging(false);
  };

  const handlePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.state === 'idle') return;
    e.stopPropagation();
    // pointercancel keeps the note at the last applied position (Selected).
    endInteraction();
  };

  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!canEdit) return; // editing a note is a board mutation
    if (!editing) onStartEdit(note.id);
  };

  const color = STICKY_COLORS[note.color];
  const showToolbar = selected && !editing && !dragging;
  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-testid={`sticky-note-${note.id}`}
      tabIndex={0}
      className="sticky-note"
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        zIndex: note.z,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: color,
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={displayFit.fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textRef}
          data-testid="sticky-note-text"
          className="sticky-text"
          data-overflow={displayFit.overflow ? 'true' : 'false'}
          style={{ fontSize: `${displayFit.fontPx}px` }}
        >
          {note.text}
        </div>
      )}
      {!editing && displayFit.overflow ? (
        <div
          className="sticky-fade"
          data-testid="sticky-overflow-fade"
          aria-hidden="true"
        />
      ) : null}
      {showToolbar ? (
        // Counter-scaled by 1/zoom so the toolbar keeps a constant on-screen size
        // while its note scales with the board.
        <div
          className="note-toolbar-scale"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          <NoteToolbar color={note.color} onColor={onColor} onDelete={onDelete} />
        </div>
      ) : null}
    </div>
  );
}
