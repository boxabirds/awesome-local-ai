// One sticky note on the board. It draws the note, owns the per-note interaction
// state machine (Unselected / Pressed / Selected / Dragging / Editing) and calls
// the board model for every change; selection and editing come in as props
// because they are the user's, not the board's.
//
// A press on the note belongs to the note: it stops propagation so the board
// never pans underneath it, and the grab only becomes a drag once the pointer has
// travelled DRAG_THRESHOLD_PX, which is what tells a click from a move.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  objectBounds,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import type { EndEditNext } from '../board/useSelection';
import { fitFontSize, NOTE_PADDING_WORLD } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Board zoom, so a drag can keep the grabbed point under the pointer. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Whether this note takes gestures. A board the room could not read is shown
   * read-only: nothing on it can be grabbed, edited, recoloured or deleted, so
   * that a person cannot make changes that have nowhere to be kept.
   */
  editable: boolean;
  /**
   * False when the note is one of several selected objects: the per-note
   * toolbar (colours, bin) belongs to a single selected note only - a group
   * gets the selection bar instead. Default true.
   */
  single?: boolean;
  /**
   * True while the board's transform gesture is moving this note (story 7
   * group drag). The note's own internal drag sets its own dragging state;
   * this one is for gestures the note does not run itself.
   */
  dragging?: boolean;
  /**
   * Given, the note hands its press to the board's transform gesture (group
   * move, group resize) and runs none of its own. Absent - a note rendered on
   * its own, outside the board's wiring - it drags itself, as it did before
   * story 7.
   */
  onGesturePointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSelect(id: string): void;
  /**
   * What the board does when the note takes keyboard focus: Tab reaches a
   * note and selects it. Absent, the note selects itself on any focus, as
   * before story 7 - but a real browser also gives a note focus when the
   * mouse presses it, and a board wired for group selection decides that
   * case itself (see the transform gesture's isPressed).
   */
  onFocusNote?(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

/** A press that may still turn into a drag. */
interface Press {
  pointerId: number;
  /** Pointer and note position when the button went down. */
  pointerX: number;
  pointerY: number;
  originX: number;
  originY: number;
  moved: boolean;
  /** Where the note is going, applied on the next animation frame. */
  targetX: number;
  targetY: number;
  pending: boolean;
}

/** The note's own buttons and text own their clicks, not the grab. */
function isOwnUi(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (target.closest('.note-toolbar') !== null || target.closest('.sticky-input') !== null)
  );
}

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  editable,
  single = true,
  dragging: draggingByBoard = false,
  onGesturePointerDown,
  onSelect,
  onFocusNote,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const dragged = dragging || draggingByBoard;
  const [font, setFont] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });
  const textRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const frame = useRef<number | null>(null);
  const draggingRef = useRef(false);
  // The zoom of the gesture, kept in a ref so a zoom that happens mid-drag
  // cannot leave a handler dividing by the wrong number.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const stopFrame = useCallback((): void => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  // A note that is gone (deleted by the keyboard, or from story 3) must not leave
  // a queued frame writing to it.
  useEffect(() => stopFrame, [stopFrame]);

  // Text auto-fit: the largest size that shows all of it, measured whenever the
  // text changes or the note is resized (story 7 - a taller note fits bigger
  // text). Zoom scales the whole note uniformly, so it needs no remeasure.
  const boxWorld = Math.max(0, objectBounds(note).height - NOTE_PADDING_WORLD * 2);
  const box = objectBounds(note);
  useLayoutEffect(() => {
    if (editing) return;
    const el = textRef.current;
    if (el === null) return;
    const fit = fitFontSize(el, boxWorld);
    setFont((previous) =>
      previous.fontPx === fit.fontPx && previous.overflow === fit.overflow
        ? previous
        : { fontPx: fit.fontPx, overflow: fit.overflow },
    );
  }, [note.text, editing, boxWorld]);

  const writePosition = useCallback((): void => {
    const current = press.current;
    if (current === null || !current.pending) return;
    current.pending = false;
    // false when the note was deleted while the pointer was moving: the gesture
    // simply stops, and nothing is recreated
    moveObject(doc, note.id, current.targetX, current.targetY);
  }, [doc, note.id]);

  const scheduleWrite = useCallback((): void => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      writePosition();
    });
  }, [writePosition]);

  const finishDrag = useCallback((): void => {
    stopFrame();
    press.current = null;
    if (draggingRef.current) {
      draggingRef.current = false;
      setDragging(false);
    }
  }, [stopFrame]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editable) return; // a board that could not be read takes no gestures at all
    // The board must never start panning from a note (sticky.no_pan).
    event.stopPropagation();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isOwnUi(event.target)) return;
    if (editing) return; // the caret and the text own this note while typing
    if (onGesturePointerDown !== undefined) {
      // the board's transform gesture takes the press: it moves the whole
      // selection and keeps its own state about what was grabbed
      onGesturePointerDown(event);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    press.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: note.x,
      originY: note.y,
      moved: false,
      targetX: note.x,
      targetY: note.y,
      pending: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - current.pointerX;
    const dy = event.clientY - current.pointerY;
    if (!current.moved) {
      // under a few pixels the pointer is a click, not a move
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      current.moved = true;
      // the note you grab comes to the top of everything it overlaps
      bringToFront(doc, note.id);
      draggingRef.current = true;
      setDragging(true);
    }
    // Screen pixels divided by the board zoom: the point that was grabbed stays
    // under the pointer at 50%, 100% or 200%.
    current.targetX = current.originX + dx / zoomRef.current;
    current.targetY = current.originY + dy / zoomRef.current;
    current.pending = true;
    scheduleWrite();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    // whatever the pointer last asked for is where the note stays
    if (current.moved) writePosition();
    finishDrag();
    onSelect(note.id);
  };

  // A drag cut short (pointer released outside the window, a system interruption)
  // keeps the position the note was last shown at.
  const onCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    finishDrag();
    onSelect(note.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!editable) return; // nothing to open for editing on a board that is not there
    // Editing this note, not creating a new one on top of it (sticky.edit_start).
    event.stopPropagation();
    if (isOwnUi(event.target)) return;
    onStartEdit(note.id);
  };

  // Tab reaches a note; a focus that came from the Tab key selects it, so the
  // swatches, the bin button and the Delete key all mean this note. A focus that
  // bubbled up from the note's own textarea is still typing and changes nothing.
  // A browser also focuses a note when the mouse presses it; a board wired for
  // group selection passes onFocusNote and decides there what a focus means.
  const onFocus = (event: ReactFocusEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    (onFocusNote ?? onSelect)(note.id);
  };

  // The text of a note deleted between renders is gone too: editing stops with it.
  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const zoomInverse = zoom === 0 ? 1 : 1 / zoom;

  return (
    <div
      className={`sticky-note${dragged ? ' is-dragging' : ''}${font.overflow ? ' has-overflow' : ''}${
        editable ? '' : ' is-locked'
      }`}
      data-testid="sticky-note"
      data-editable={editable}
      data-note-id={note.id}
      data-note-x={note.x}
      data-note-y={note.y}
      data-note-z={note.z}
      data-selected={selected}
      data-dragging={dragged}
      data-editing={editing}
      data-color={note.color}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={
        {
          left: `${note.x}px`,
          top: `${note.y}px`,
          // the stored size once a resize wrote one; the standard note size
          // until then (objectBounds is the only place that default lives)
          width: `${box.width}px`,
          height: `${box.height}px`,
          background: STICKY_COLORS[note.color],
          // The note this one overlaps is drawn under it. Stacking is done here
          // rather than by reordering the DOM, so the element a drag has captured
          // is never moved out from under the pointer.
          zIndex: note.z,
          // the text box inset and the fade colour come from the same settings
          // the auto-fit maths uses, so CSS and measurement cannot drift apart
          '--note-inset': `${NOTE_PADDING_WORLD}px`,
          '--note-fill': STICKY_COLORS[note.color],
        } as CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onCancel}
      onLostPointerCapture={onCancel}
      onDoubleClick={onDoubleClick}
      onFocus={onFocus}
    >
      {ytext !== undefined ? (
        <StickyTextEditor ytext={ytext} fontPx={font.fontPx} boxWorld={boxWorld} onEnd={onEndEdit} />
      ) : (
        <>
          <div
            ref={textRef}
            className={`sticky-text${font.overflow ? ' has-overflow' : ''}`}
            data-testid="sticky-text"
            data-font-px={font.fontPx}
            data-overflow={font.overflow}
            style={{ fontSize: `${font.fontPx}px` }}
          >
            {note.text}
          </div>
          {font.overflow ? (
            <span className="sticky-fade" data-testid="sticky-fade" aria-hidden="true" />
          ) : null}
        </>
      )}
      {selected && single && !dragged && !editing ? (
        // The toolbar keeps its screen size at any zoom: it is scaled by the
        // inverse of the board, which is why the note needs the zoom at all.
        <div
          className="note-toolbar-anchor"
          style={{ transform: `scale(${zoomInverse})`, transformOrigin: 'left bottom' }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color) => {
              setStickyColor(doc, note.id, color);
            }}
            onDelete={() => {
              deleteObject(doc, note.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
