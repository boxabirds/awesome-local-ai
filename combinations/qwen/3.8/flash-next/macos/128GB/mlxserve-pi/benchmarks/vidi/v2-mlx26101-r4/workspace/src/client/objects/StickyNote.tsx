/**
 * One sticky note on the board: how it looks, how it is selected, how it is
 * dragged and how it is typed into.
 *
 * Interaction states for a note (local only, exactly the design's diagram):
 *
 *   Unselected → Pressed → Selected ⇄ Editing
 *                  ↓  ↑        ↑
 *               Dragging ──────┘
 *
 * A short press selects; movement past `DRAG_THRESHOLD_PX` drags instead. The
 * pointer is captured to the note, so a drag keeps moving it even when the
 * pointer leaves the note, and the `pointerdown` stops propagation, which is
 * what keeps the board from panning underneath it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import type * as Y from 'yjs';

import { bringToFront, deleteObject, getStickyText, moveObject, setStickyColor } from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import type { StickySnapshot } from '../../shared/board-model';
import { NoteToolbar } from './NoteToolbar';
import { STICKY_TEXT_BOX, StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';
import type { Fit } from './StickyText';
import type { EndEditTarget } from '../board/useSelection';

/** Gap between the top of a note and its toolbar, in screen pixels. */
const TOOLBAR_GAP_PX = 8;

/** The mouse button that picks a note up. */
const PRIMARY_MOUSE_BUTTON = 0;

/** What this note's pointer is doing right now (never stored in the document). */
type NoteInteraction = 'idle' | 'pressed' | 'dragging';

/** A pointer that is down on the note, dragging or about to. */
interface Drag {
  pointerId: number;
  /** Pointer position when the note was pressed, in screen pixels. */
  startX: number;
  startY: number;
  /** Where the note was when it was pressed, in world units. */
  noteX: number;
  noteY: number;
  /** Latest pointer position; applied on the next animation frame. */
  lastX: number;
  lastY: number;
  /** False until movement passes the threshold; a press that has not moved. */
  dragging: boolean;
}

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom: a drag moves the note by `screen delta / zoom` world units. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * This board cannot be written to (see `canEdit` in App): the note is still shown
   * — a board that could not be loaded shows whatever it has, and it may have
   * nothing — but no gesture of any kind reaches the document.
   */
  readOnly?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  /** Editing stopped: the note stays selected (Escape) or does not (click away). */
  onEndEdit(next: EndEditTarget): void;
}

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  readOnly = false,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): JSX.Element {
  const elementRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const [interaction, setInteraction] = useState<NoteInteraction>('idle');
  const [fit, setFit] = useState<Fit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // The zoom and document a drag in flight must use. They are refreshed in an
  // effect so a frame callback that was queued earlier still sees the current
  // zoom, and stops touching the document the moment the note is gone.
  const live = useRef<{ zoom: number; doc: Y.Doc | null }>({ zoom, doc });
  useEffect(() => {
    live.current = { zoom, doc };
  });

  /** Move the note to the pointer's latest position. */
  const applyDrag = useCallback((): void => {
    const current = drag.current;
    if (!current?.dragging) return;
    const { zoom: scale, doc: document } = live.current;
    // The note was deleted while it was held — by a keyboard shortcut, or by
    // another client in a later story. This component is unmounted by then, so a
    // frame still in flight lets go of the document instead of writing to it.
    if (document === null) {
      drag.current = null;
      return;
    }
    const divisor = scale > 0 ? scale : 1;
    const worldX = current.noteX + (current.lastX - current.startX) / divisor;
    const worldY = current.noteY + (current.lastY - current.startY) / divisor;
    // A `false` here only means the note is already at that position: a frame
    // with nothing to write must not end the drag, or a drag that pauses between
    // frames would stop following the pointer for good.
    moveObject(document, note.id, worldX, worldY);
  }, [note.id]);

  /** Position changes are applied once per animation frame, not per event. */
  const scheduleDrag = useCallback((): void => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      applyDrag();
    });
  }, [applyDrag]);

  const stopFrame = (): void => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (readOnly) {
      // The press stops here: the board neither pans nor selects, because a note
      // that cannot be moved should not look like it can be.
      event.stopPropagation();
      return;
    }
    // Only the left button picks a note up; the others are left alone.
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;

    // The board neither pans nor clears its selection because of a note.
    event.stopPropagation();
    if (editing) return; // typing belongs to the textarea, not to the drag machine

    event.target && (event.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      noteX: note.x,
      noteY: note.y,
      lastX: event.clientX,
      lastY: event.clientY,
      dragging: false,
    };
    setInteraction('pressed');
    // Pressing a note selects it straight away; a drag that follows only moves
    // it, so the outline appears the moment the note is picked up.
    onSelect(note.id);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (readOnly) return;
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.lastX = event.clientX;
    current.lastY = event.clientY;

    if (current.dragging) {
      scheduleDrag();
      return;
    }

    const dx = current.lastX - current.startX;
    const dy = current.lastY - current.startY;
    const travelled = Math.max(Math.abs(dx), Math.abs(dy));
    // Under the threshold this is still a press: a hand jitter between mousedown
    // and mouseup must not move a note the user only meant to select.
    if (!(travelled >= DRAG_THRESHOLD_PX)) return;

    current.dragging = true;
    setInteraction('dragging');
    // Once per drag: the note being moved belongs above everything it crosses.
    bringToFront(doc, note.id);
    applyDrag();
  };

  /** The press is over: the note ends up selected, wherever it was last shown. */
  const endInteraction = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.dragging) {
      // Flush the queued frame so the note ends exactly under the pointer
      // rather than one frame behind it.
      stopFrame();
      applyDrag();
    }
    drag.current = null;
    setInteraction('idle');
    onSelect(note.id);
  };

  /**
   * A drag that never finished normally — pointer released outside the window,
   * a system gesture, the capture lost — leaves the note at the position it was
   * last shown in, and still selects it.
   */
  const cancelInteraction = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    // Whatever was queued is dropped: the note stays where it was last shown.
    stopFrame();
    drag.current = null;
    setInteraction('idle');
    onSelect(note.id);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // A note is edited, never duplicated: the board must not see this click.
    event.stopPropagation();
    if (editing || readOnly) return;
    onStartEdit(note.id);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Reached by keyboard: Tab moves to a note, Enter edits it, and the board's
    // own shortcuts (Delete, Escape) are handled where the selection lives.
    if (event.key !== 'Enter') return;
    // While typing, Enter belongs to the text: a keydown that started in the
    // textarea arrives here by bubbling, and must not be swallowed.
    if (editing || readOnly) return;
    event.preventDefault();
    onStartEdit(note.id);
  };

  // A note that disappears mid-interaction leaves nothing behind: the queued
  // frame is cancelled and the drag state dropped, so no frame writes to a
  // document whose note is gone.
  useEffect(
    () => () => {
      live.current = { zoom: live.current.zoom, doc: null };
      stopFrame();
      drag.current = null;
    },
    [],
  );

  // The displayed text is measured in the layout phase, so the font size lands
  // before the browser paints and the note never flashes at the wrong size.
  // While editing, the editor measures the textarea as the user types instead.
  useLayoutEffect(() => {
    if (editing) return;
    const element = textRef.current;
    if (!element) return;
    const measured = fitFontSize(element, STICKY_TEXT_BOX);
    setFit((previous) =>
      previous.fontPx === measured.fontPx && previous.overflow === measured.overflow
        ? previous
        : measured,
    );
  }, [note.text, editing]);

  // A pointerdown anywhere outside this note ends editing and lets go of it.
  // Capture phase, so it runs before the board reacts to the same press.
  useEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent): void => {
      const element = elementRef.current;
      if (element && event.target instanceof Node && element.contains(event.target)) return;
      onEndEdit('unselected');
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  }, [editing, onEndEdit]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={elementRef}
      className={fit.overflow ? 'sticky-note sticky-note--overflow' : 'sticky-note'}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-note-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={interaction}
      data-overflow={fit.overflow ? 'true' : 'false'}
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: STICKY_COLORS[note.color],
        fontSize: `${fit.fontPx}px`,
        // Stacking lives here, not in the order of the children: raising a note
        // that is held has to be a style change, not a move in the document.
        zIndex: note.z,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={cancelInteraction}
      onLostPointerCapture={cancelInteraction}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} onFit={setFit} />
      ) : (
        <div className="sticky-note__text" data-testid="sticky-text" ref={textRef}>
          {note.text}
        </div>
      )}
      {fit.overflow ? <div className="sticky-note__fade" data-testid="sticky-fade" aria-hidden="true" /> : null}
      {selected && !editing && interaction !== 'dragging' ? (
        <div
          className="sticky-note__toolbar-slot"
          data-testid="note-toolbar-slot"
          style={{
            bottom: STICKY_SIZE_WORLD,
            // The note itself is scaled by the zoom, so scaling the toolbar by
            // the reciprocal keeps it the same size on screen at every zoom.
            transform: `scale(${1 / (zoom > 0 ? zoom : 1)}) translateY(${-TOOLBAR_GAP_PX}px)`,
          }}
        >
          <NoteToolbar
            color={note.color}
            disabled={readOnly}
            onColor={(color) => {
              // Colour only: text, position, stacking and the selection stay put.
              setStickyColor(doc, note.id, color);
            }}
            onDelete={() => {
              // The board drops the selection with the note (see App).
              deleteObject(doc, note.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
