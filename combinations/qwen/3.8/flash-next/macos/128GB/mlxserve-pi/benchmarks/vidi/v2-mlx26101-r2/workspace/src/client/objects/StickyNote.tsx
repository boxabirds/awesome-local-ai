import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import * as Y from 'yjs';

import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model.js';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_PADDING_WORLD,
  type StickyColor,
} from '../../shared/config.js';
import type { EndEditNext } from '../board/useSelection.js';
import { NoteToolbar } from './NoteToolbar.js';
import { fitFontSize } from './StickyText.js';
import { StickyTextEditor } from './StickyTextEditor.js';

export interface StickyNoteProps {
  /** The note as it currently is in the document. */
  note: StickySnapshot;
  /** The document the note lives in; every mutation goes through board-model. */
  doc: Y.Doc;
  /** Camera zoom: keeps the grabbed point under the pointer while dragging. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * False while the board takes no edits (see `canEdit`). Every gesture that would
   * write to the document is a no-op then - drag, recolour, delete, open for
   * typing - while the note still behaves like a note to the pointer: it takes the
   * press, so the board behind it does not pan, and it can still be selected,
   * because which note a person is looking at is not board content.
   */
  canEdit?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

/** Only the primary pointer button drags a note. */
const PRIMARY_BUTTON = 0;

/** Squared distance: the threshold check needs no square root. */
const distanceSq = (dx: number, dy: number): number => dx * dx + dy * dy;

interface DragState {
  pointerId: number;
  /** Pointer position at pointerdown, in screen pixels. */
  fromX: number;
  fromY: number;
  /** Note position at pointerdown, in world units. */
  originX: number;
  originY: number;
  /** True once the pointer has travelled past DRAG_THRESHOLD_PX. */
  dragging: boolean;
  /** Position to apply on the next animation frame. */
  pending: { x: number; y: number } | null;
}

/**
 * One sticky note on the board: it draws the note and owns the per-note
 * interaction state machine from the design
 * (Unselected - Pressed - Selected - Dragging - Editing).
 *
 * Where the state lives:
 * - `dragging` is local component state: it is how the note is being handled
 *   right now, not board content;
 * - selection and editing live in `useSelection` (App), so clicking empty board
 *   space can clear them;
 * - position, colour, text and stacking live in the Y.Doc, written through
 *   board-model - which is why story 3 (live sharing) and story 4 (saving) need
 *   no change here.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  canEdit = true,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  const noteElementRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<number | null>(null);
  // Values the drag maths reads: always the latest, even inside a frame callback
  // scheduled before React re-rendered.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const latestNote = useRef(note);
  latestNote.current = note;

  /** The note's shared text; `undefined` only in the moment before removal. */
  const ytext = getStickyText(doc, note.id);

  /**
   * Auto-fit (sticky.text_fit): the largest integer font size at which the text
   * still fits inside the note. Measured in board units, so a zoom change never
   * needs a remeasurement - the whole note is scaled uniformly - and only a text
   * change does.
   */
  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;
    const box =
      measure.clientHeight > 0
        ? measure.clientHeight
        : STICKY_SIZE_WORLD - 2 * STICKY_TEXT_PADDING_WORLD;
    const next = fitFontSize(measure, box);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [note.text]);

  /** Cancel the frame loop; whatever position was applied stays applied. */
  const stopFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const drag = dragRef.current;
    if (drag) drag.pending = null;
  }, []);

  const applyPendingMove = useCallback(() => {
    frameRef.current = null;
    const drag = dragRef.current;
    if (!drag) return;
    const target = drag.pending;
    drag.pending = null;
    if (!target) return;
    // false means the note is gone: the drag then ends by itself, because the
    // component unmounts with the note (TC-37).
    if (!moveObject(doc, latestNote.current.id, target.x, target.y)) {
      dragRef.current = null;
      setDragging(false);
    }
  }, [doc]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== PRIMARY_BUTTON) return;
      // While editing, the textarea handles the pointer (caret placement).
      if (editing) return;
      // The board must not pan when a note is grabbed (sticky.no_pan).
      event.stopPropagation();
      // A locked board takes the press and goes no further with it: no drag is
      // armed, so there is nothing for the moves to write. Letting the press fall
      // through instead would pan the board every time someone tried to find out
      // whether this note could be moved.
      if (!canEdit) {
        onSelect(note.id);
        return;
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        fromX: event.clientX,
        fromY: event.clientY,
        originX: note.x,
        originY: note.y,
        dragging: false,
        pending: null,
      };
    },
    [canEdit, editing, note.id, note.x, note.y, onSelect],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - drag.fromX;
      const dy = event.clientY - drag.fromY;

      if (!drag.dragging) {
        // A short press without movement selects; anything further drags. 2 px
        // is still a select, exactly DRAG_THRESHOLD_PX starts a drag.
        if (distanceSq(dx, dy) < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        drag.dragging = true;
        setDragging(true);
        // The note under the pointer comes to the front - once per drag - so it
        // is drawn above everything it overlaps.
        bringToFront(doc, note.id);
        onSelect(note.id);
      }

      // Screen pixels / zoom = world units, which keeps the grabbed point under
      // the pointer at 50%, 100% and 200% (sticky.move). One write per frame.
      drag.pending = {
        x: drag.originX + dx / zoomRef.current,
        y: drag.originY + dy / zoomRef.current,
      };
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(applyPendingMove);
      }
    },
    [applyPendingMove, doc, note.id, onSelect],
  );

  /** pointerup, pointercancel and lostpointercapture all end the gesture. */
  const finishGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      // A cancelled drag keeps the last position that was applied: "the note
      // stays where it was last shown".
      stopFrame();
      dragRef.current = null;
      setDragging(false);
      onSelect(note.id);
    },
    [note.id, onSelect, stopFrame],
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // A double-click on a note edits that note; it never creates another one,
      // and never reaches the viewport (which would).
      event.stopPropagation();
      if (editing) return;
      // An open editor is a promise that what is typed will be saved, and on a
      // board that cannot be loaded it could not be kept. The keystrokes have
      // nowhere to go, which is the honest version of the badge's sentence.
      if (!canEdit) return;
      onStartEdit(note.id);
    },
    [canEdit, editing, note.id, onStartEdit],
  );

  // A note that disappears mid-drag or mid-edit ends silently: the frame loop is
  // cancelled here and nothing is written or re-created (TC-37).
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      dragRef.current = null;
    },
    [],
  );

  const handleColor = useCallback(
    (color: StickyColor) => {
      // Only the colour changes (sticky.color): text, position and stacking are
      // untouched, and the note stays selected.
      if (!canEdit) return;
      setStickyColor(doc, note.id, color);
    },
    [canEdit, doc, note.id],
  );

  const handleDelete = useCallback(() => {
    // The bin button (and the Delete key, in App) removes the note from the
    // document; App then drops the selection that pointed at it.
    if (!canEdit) return;
    deleteObject(doc, note.id);
  }, [canEdit, doc, note.id]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // Enter on a focused note starts editing. App listens on window too, for
      // the same shortcut when focus is elsewhere on the page.
      if (event.key === 'Enter' && !editing) {
        event.preventDefault();
        if (canEdit) onStartEdit(note.id);
      }
    },
    [canEdit, editing, note.id, onStartEdit],
  );

  return (
    <div
      ref={noteElementRef}
      className="sticky-note"
      data-sticky-note={note.id}
      data-testid="sticky-note"
      data-note-id={note.id}
      data-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: STICKY_COLORS[note.color],
        // The stacking order is CSS's, not the DOM's: a note that is brought to
        // the front changes this number and is drawn above the others without its
        // element moving, so a drag in progress is never interrupted (sticky.move).
        zIndex: String(note.z),
        // Page-chrome children (note toolbar, counter) undo the world scale
        // with this, so they keep a constant size on screen.
        ['--inverse-zoom' as string]: String(1 / (zoom || 1)),
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
      onLostPointerCapture={finishGesture}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="sticky-note-content">
        {editing && ytext ? (
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
        ) : (
          <div
            className="sticky-text"
            data-testid="sticky-text"
            style={{ fontSize: `${fit.fontPx}px` }}
          >
            {note.text}
          </div>
        )}
        {/* The measurement element carries the same text with the same wrapping
            but is never seen; it is what the fit search measures. */}
        <div ref={measureRef} className="sticky-measure" aria-hidden="true">
          {note.text}
        </div>
        {fit.overflow ? <div className="sticky-fade" data-testid="sticky-fade" aria-hidden="true" /> : null}
      </div>

      {/* The note toolbar belongs to the selected note only, and is hidden while
          that note is being dragged or edited (PRD "Structure"). */}
      {selected && !dragging && !editing ? (
        <div className="note-toolbar-anchor">
          <NoteToolbar
            color={note.color}
            onColor={handleColor}
            onDelete={handleDelete}
            canEdit={canEdit}
          />
        </div>
      ) : null}
    </div>
  );
}
