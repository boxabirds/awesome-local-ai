import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  objectExists,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import type { EndEditNext } from '../board/useSelection';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

/** Padding between the note edge and its text, in world units. */
export const STICKY_PADDING_WORLD = 12;
/** The box the text has to fit in; `fitFontSize` compares `scrollHeight` with it. */
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;
/** Selection outline colour (PRD: a blue outline). */
export const SELECTION_OUTLINE = '#2563eb';
/** Keeps the selected note (and its toolbar) above every other note. */
export const SELECTED_STACK_ABOVE = 1_000_000;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, needed to keep the grabbed point under the pointer at any zoom. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
  /**
   * Story 4: a board that could not be load refuses edits (PRD: "cannot be edited").
   * Selection stays allowed — looking is not editing.
   */
  readOnly?: boolean;
}

/** One press on a note: `Pressed`, then `Dragging` once the pointer has moved enough. */
interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  /** Where the note's top-left was when the pointer came down. */
  originX: number;
  originY: number;
  dragging: boolean;
  /** Latest pointer target position in world units, written on the next frame. */
  pending: { x: number; y: number } | null;
}

/**
 * One sticky note: rendering, selection, drag-to-move, colour, delete and text editing.
 *
 * The note lives in the world layer, so its geometry is in world units and it scales
 * with the board; the note toolbar is counter-scaled by 1/zoom so it stays readable.
 * Selection and editing come from props and stay local — nothing about this interaction
 * is written to the document.
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
  readOnly = false,
}: StickyNoteProps): JSX.Element {
  const noteRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  // The frame we are waiting for to write the next position, if any (sticky.drag).
  const frameRef = useRef<{ id: number } | null>(null);
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const background = STICKY_COLORS[note.color];
  const ytext = useMemo(() => getStickyText(doc, note.id), [doc, note.id]);

  /**
   * Auto-fit the text. Measuring the always-rendered text layer (hidden behind the
   * textarea while editing) means display and editing text share one font size, and
   * `scrollHeight` is measured in world units, unaffected by the zoom transform.
   */
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const next = fitFontSize(el, STICKY_TEXT_BOX_WORLD);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [note.text, editing]);

  const cancelFrame = useCallback((): void => {
    const frame = frameRef.current;
    if (!frame) return;
    frameRef.current = null;
    cancelAnimationFrame(frame.id);
  }, []);

  const docRef = useRef(doc);
  docRef.current = doc;
  // Trackers registered on `window`, removed when the drag ends or the note unmounts.
  const trackersRef = useRef<{ move: (event: PointerEvent) => void; end: (event: PointerEvent) => void } | null>(null);

  // A note that disappears mid-drag (a stale id) just stops moving.
  useEffect(() => {
    return () => {
      cancelFrame();
      const trackers = trackersRef.current;
      if (!trackers) return;
      trackersRef.current = null;
      window.removeEventListener('pointermove', trackers.move);
      window.removeEventListener('pointerup', trackers.end);
      window.removeEventListener('pointercancel', trackers.end);
    };
  }, [cancelFrame]);

  const flushPendingMove = useCallback((): void => {
    const gesture = gestureRef.current;
    if (!gesture || !gesture.pending) return;
    const { x, y } = gesture.pending;
    gesture.pending = null;
    if (!moveObject(doc, note.id, x, y) && !objectExists(doc, note.id)) {
      // The note was deleted while we were dragging it: end quietly, keep the deletion.
      gestureRef.current = null;
      cancelFrame();
      setDragging(false);
    }
  }, [doc, note.id, cancelFrame]);

  /** Queue one write of the latest pointer position for the next frame. */
  const scheduleFlush = useCallback((): void => {
    if (frameRef.current) return;
    const frame: { id: number } = { id: 0 };
    frameRef.current = frame;
    const id = requestAnimationFrame(() => {
      if (frameRef.current === frame) frameRef.current = null;
      flushPendingMove();
    });
    // A test stub may run the callback synchronously, leaving nothing to cancel.
    if (frameRef.current === frame) frame.id = id;
  }, [flushPendingMove]);

  /*
   * The drag is tracked on `window`, not on the note element: bringing the note to the
   * front re-inserts its DOM node in the world layer, which would release a pointer
   * capture and end the drag on the first move.
   */
  const trackMove = (event: PointerEvent): void => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.dragging) {
      // Below the threshold the note stays Pressed and nothing moves (TC-19).
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      gesture.dragging = true;
      setDragging(true);
      // Once per drag: the dragged note comes to the front of everything it overlaps.
      bringToFront(docRef.current, note.id);
    }
    const scale = zoomRef.current || 1;
    gesture.pending = { x: gesture.originX + dx / scale, y: gesture.originY + dy / scale };
    scheduleFlush();
  };

  const trackEnd = (event: PointerEvent): void => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    stopTracking();
    // Whatever the last frame saw is the position the note keeps (TC-21).
    cancelFrame();
    flushPendingMove();
    if (gestureRef.current === gesture) gestureRef.current = null;
    setDragging(false);
    // A press without a drag, and a drag that ended, both leave the note selected.
    onSelect(note.id);
  };

  const stopTracking = (): void => {
    const trackers = trackersRef.current;
    if (!trackers) return;
    trackersRef.current = null;
    window.removeEventListener('pointermove', trackers.move);
    window.removeEventListener('pointerup', trackers.end);
    window.removeEventListener('pointercancel', trackers.end);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Touch devices are out of scope for this story.
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    // The board must never start a pan from a note (sticky.no_pan).
    event.stopPropagation();
    if (readOnly) {
      // A board that could not be loaded is not editable (story 4): selecting still
      // works, dragging never starts.
      onSelect(note.id);
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'TEXTAREA') return; // let the caret move inside the editor
    if (editing) onEndEditRef.current('selected');

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: note.x,
      originY: note.y,
      dragging: false,
      pending: null,
    };
    stopTracking();
    const move = (nativeEvent: PointerEvent): void => trackMove(nativeEvent);
    const end = (nativeEvent: PointerEvent): void => trackEnd(nativeEvent);
    trackersRef.current = { move, end };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // The viewport would otherwise create a second note here (TC-35).
    event.stopPropagation();
    if (editing || readOnly) return;
    onStartEdit(note.id);
  };

  const onFocus = (event: ReactFocusEvent<HTMLDivElement>): void => {
    // Tab reaches the note; Enter then starts editing it.
    if (event.target !== event.currentTarget) return;
    onSelect(note.id);
  };

  // A pointerdown anywhere outside the note ends editing and clears the selection.
  useEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent): void => {
      const element = noteRef.current;
      const target = event.target as Node | null;
      if (!element || !target) return;
      if (element.contains(target)) return;
      onEndEditRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
    };
  }, [editing]);

  const handleEndEdit = useCallback((next: EndEditNext): void => {
    onEndEditRef.current(next);
  }, []);

  const handleColor = (color: StickyColor): void => {
    // Only the colour changes: text, position, stacking and the selection are untouched.
    setStickyColor(doc, note.id, color);
  };

  const handleDelete = (): void => {
    deleteObject(doc, note.id);
  };

  // A read-only board has no colour and delete to give away either.
  const showToolbar = selected && !editing && !dragging && !readOnly;

  const noteStyle = {
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${STICKY_SIZE_WORLD}px`,
    height: `${STICKY_SIZE_WORLD}px`,
    backgroundColor: background,
    zIndex: selected ? SELECTED_STACK_ABOVE : note.z,
    outlineWidth: selected ? '2px' : '0',
    outlineColor: SELECTION_OUTLINE,
    // The text box inset both the text layer and the textarea use.
    '--vidi6-sticky-pad': `${STICKY_PADDING_WORLD}px`,
  } as CSSProperties;

  return (
    <div
      ref={noteRef}
      className="vidi6-sticky"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-note-x={note.x}
      data-note-y={note.y}
      data-note-z={note.z}
      data-note-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={noteStyle}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onFocus={onFocus}
    >
      <div
        ref={contentRef}
        className={editing ? 'vidi6-sticky-content vidi6-sticky-measuring' : 'vidi6-sticky-content'}
        data-testid="sticky-text"
      >
        {note.text}
      </div>
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={handleEndEdit} />
      ) : null}
      {fit.overflow ? (
        <div
          className="vidi6-sticky-fade"
          data-testid="sticky-fade"
          style={{ background: `linear-gradient(to bottom, rgba(0, 0, 0, 0), ${background})` }}
        />
      ) : null}
      {showToolbar ? (
        <div
          className="vidi6-sticky-toolbar-anchor"
          style={{ transform: `scale(${1 / (zoomRef.current || 1)})` }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      ) : null}
    </div>
  );
}
