import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_OVERFLOW_BAND_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import type { EndEditTarget } from '../board/useSelection';

/** Inner padding of a note, in board units (a visual detail, not a product setting). */
const NOTE_PADDING = 14;

/** Height available for text, in board units. */
const TEXT_BOX = STICKY_SIZE_WORLD - NOTE_PADDING * 2;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom (screen pixels per board unit): notes scale with the board. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditTarget): void;
  /** Read-only board: the note can be selected, and nothing else. */
  locked?: boolean;
}

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  dragged: boolean;
}

/**
 * One sticky note on the board.
 *
 * Renders at world `(x, y)` inside the scaled world layer, size
 * STICKY_SIZE_WORLD, filled with its colour, text centred and auto-fitted.
 * Handles the per-note interaction state machine
 * Unselected -> Pressed -> (Selected | Dragging) -> Editing:
 * a press that stays within DRAG_THRESHOLD_PX selects, a press that travels
 * further drags the note (bringing it to the front once) while the board stays
 * put, a double-click edits, Escape or a click outside ends editing.
 *
 * Selection and editing live in the owner (`useSelection`); the document holds
 * only board content.
 */
export function StickyNote(props: StickyNoteProps) {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit, locked = false } =
    props;
  const noteRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [font, setFont] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const [dragging, setDragging] = useState(false);
  const pressRef = useRef<Press | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  // --- Font auto-fit (measure on mount and whenever the text changes) -------
  // The measure element mirrors the note's text box, so fit is independent of
  // whether the note is being edited. Zoom scales uniformly, so it is not a
  // dependency.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const next = fitFontSize(el, TEXT_BOX);
    setFont((prev) =>
      prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next,
    );
  }, [note.text]);

  // --- Pending drag position ------------------------------------------------
  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const flushMove = useCallback(() => {
    cancelFrame();
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    // A note deleted mid-drag makes moveObject return false: end silently.
    if (!moveObject(doc, note.id, p.x, p.y)) {
      pressRef.current = null;
      setDragging(false);
    }
  }, [cancelFrame, doc, note.id]);

  const scheduleMove = useCallback(
    (x: number, y: number) => {
      pendingRef.current = { x, y };
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const p = pendingRef.current;
        pendingRef.current = null;
        if (!p) return;
        if (!moveObject(doc, note.id, p.x, p.y)) {
          pressRef.current = null;
          setDragging(false);
        }
      });
    },
    [doc, note.id],
  );

  // Interaction ends when the note goes away (deleted locally or by somebody
  // else): this component unmounts, so drop any pending work without writing.
  useEffect(
    () => () => {
      cancelFrame();
      pendingRef.current = null;
      pressRef.current = null;
    },
    [cancelFrame],
  );

  // --- Click outside the note ends editing ---------------------------------
  useEffect(() => {
    if (!editing) return;
    const onDocPointerDown = (event: PointerEvent) => {
      const el = noteRef.current;
      if (!el) return;
      if (event.target instanceof Node && !el.contains(event.target)) {
        onEndEdit('unselected');
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [editing, onEndEdit]);

  // --- Pointer interaction -------------------------------------------------
  const isInside = (target: EventTarget | null, selector: string): boolean =>
    target instanceof Element && target.closest(selector) != null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // The board must never pan, or clear the selection, because of a note.
    e.stopPropagation();
    if (isInside(e.target, '[data-note-toolbar]')) return;
    if (locked) {
      // Selecting is local and harmless; dragging would be a change nobody can
      // save, so the press stops here.
      onSelect(note.id);
      return;
    }
    if (editing) {
      // A press on the note itself (outside the textarea) stops editing but
      // keeps the note selected; a press in the textarea moves the caret.
      if (!isInside(e.target, '[data-sticky-textarea]')) onEndEdit('selected');
      return;
    }
    pressRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: note.x,
      originY: note.y,
      dragged: false,
    };
    try {
      noteRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture unsupported (e.g. jsdom) */
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press) return;
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (!press.dragged) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still Pressed
      press.dragged = true;
      setDragging(true);
      bringToFront(doc, note.id); // drawn above everything it overlaps
    }
    // Screen pixels divided by zoom = board units, so the grabbed point stays
    // under the pointer at 50%, 100% or 200%.
    scheduleMove(press.originX + dx / zoom, press.originY + dy / zoom);
  };

  const releaseCapture = (pointerId: number) => {
    try {
      if (noteRef.current?.hasPointerCapture?.(pointerId)) {
        noteRef.current.releasePointerCapture(pointerId);
      }
    } catch {
      /* ignore */
    }
  };

  const endPress = (e: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press) return;
    e.stopPropagation();
    flushMove(); // keep the last position shown
    pressRef.current = null;
    setDragging(false);
    releaseCapture(e.pointerId);
    onSelect(note.id); // Selected (also after a drag or a cancelled drag)
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isInside(e.target, '[data-note-toolbar]')) return;
    // Editing this note instead of letting the viewport create a new one.
    e.stopPropagation();
    e.preventDefault();
    if (locked) return;
    onStartEdit(note.id);
  };

  const handleColor = (color: StickyColor) => {
    // Only the colour changes: text, position, stacking and selection stay.
    setStickyColor(doc, note.id, color);
  };

  const handleDelete = () => {
    // The bin button. The owner clears the selection once the note is gone.
    deleteObject(doc, note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={noteRef}
      className="sticky-note"
      data-sticky-note=""
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-overflow={font.overflow ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-locked={locked ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: STICKY_COLORS[note.color],
        // Stacking comes from the model's z, not from DOM order, so raising a note
        // mid-drag never moves its element (that would drop the pointer capture).
        zIndex: note.z,
        pointerEvents: 'auto',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onLostPointerCapture={endPress}
      onDoubleClick={onDoubleClick}
    >
      {/* Hidden mirror used to measure the text for font auto-fit. */}
      <div
        ref={measureRef}
        className="sticky-text-style sticky-measure"
        aria-hidden="true"
        style={{ width: `${TEXT_BOX}px`, left: `${NOTE_PADDING}px` }}
      >
        {note.text}
      </div>

      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={font.fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          className="sticky-text-style sticky-text"
          data-sticky-text=""
          style={{
            fontSize: `${font.fontPx}px`,
            padding: `${NOTE_PADDING}px`,
          }}
        >
          {note.text}
        </div>
      )}

      {font.overflow ? (
        <div
          className="sticky-fade"
          data-sticky-fade=""
          style={{
            height: `${STICKY_OVERFLOW_BAND_PX}px`,
            // Same colour as the note, from fully transparent to opaque, so the
            // text fades into the note instead of into a white veil.
            background: `linear-gradient(to bottom, ${STICKY_COLORS[note.color]}00, ${STICKY_COLORS[note.color]})`,
          }}
        />
      ) : null}

      {selected && !editing && !dragging && !locked ? (
        <div
          className="note-toolbar-anchor"
          style={{
            // Counter-scale and centre so the toolbar keeps a constant screen
            // size, centred above the note at every zoom level.
            transform: `translateX(-50%) scale(${zoom === 0 ? 1 : 1 / zoom})`,
          }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      ) : null}
    </div>
  );
}
