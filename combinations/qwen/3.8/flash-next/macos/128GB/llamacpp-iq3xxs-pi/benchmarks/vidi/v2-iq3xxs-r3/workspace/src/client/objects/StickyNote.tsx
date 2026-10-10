import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import {
  NOTE_TOOLBAR_GAP_PX,
  NOTE_TOOLBAR_HEIGHT_PX,
  NoteToolbar,
} from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

/** Text inset inside a note (board units); mirrors the CSS padding. */
export const STICKY_TEXT_PADDING = 12;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom: screen pixel deltas become world deltas divided by it. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * False while this client may not write to the board (`canEdit`):
   * dragging, recolouring, deleting and editing this note do nothing, while
   * selecting it and reading it still work (persist.client_status).
   */
  editable: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** Interaction state machine of one note (per client, never in the doc). */
interface Press {
  pointerId: number;
  /** Pointer position at press, screen pixels. */
  startX: number;
  startY: number;
  /** Note top-left at press, world units. */
  originX: number;
  originY: number;
  /** True once movement crossed DRAG_THRESHOLD_PX. */
  dragging: boolean;
  /** Latest position not yet written (frames apply it). */
  pending: { x: number; y: number } | null;
  frame: number | null;
}

/**
 * One sticky note: renders from the snapshot, owns the press/drag/select/
 * edit interaction, and calls board-model mutations for everything it
 * changes. pointerdown stops propagation, so dragging a note never pans the
 * board (sticky.no_pan).
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  editable,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): JSX.Element {
  const pressRef = useRef<Press | null>(null);
  const [dragging, setDragging] = useState(false);

  // Frames and late events read the newest zoom/doc without re-subscribing.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const docRef = useRef(doc);
  docRef.current = doc;
  const idRef = useRef(note.id);
  idRef.current = note.id;

  const cancelFrame = (press: Press): void => {
    if (press.frame !== null) {
      cancelAnimationFrame(press.frame);
      press.frame = null;
    }
  };

  /** Write the queued position; false once the note no longer exists. */
  const applyPending = (press: Press): boolean => {
    if (!press.pending) return true;
    const { x, y } = press.pending;
    press.pending = null;
    return moveObject(docRef.current, idRef.current, x, y);
  };

  // A note deleted mid-drag unmounts this component; never leave a frame
  // scheduled that writes to a stale id (TC-37).
  useEffect(
    () => () => {
      const press = pressRef.current;
      if (press) cancelFrame(press);
    },
    [],
  );

  const scheduleFrame = (press: Press): void => {
    if (press.frame !== null) return;
    press.frame = requestAnimationFrame(() => {
      press.frame = null;
      if (applyPending(press)) return;
      // The note vanished mid-drag (stale id): end the interaction silently.
      press.pending = null;
      pressRef.current = null;
      setDragging(false);
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // The board must never pan, and must never clear this note's selection
    // because of a press on it (sticky.no_pan, sticky.select).
    event.stopPropagation();
    if (event.button !== 0) return;
    if (editing) return; // the textarea owns pointer input while editing
    const element = event.currentTarget;
    pressRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: note.x,
      originY: note.y,
      dragging: false,
      pending: null,
      frame: null,
    };
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    // A note on a board that could not be loaded stays where it is: the press
    // never becomes a drag, so nothing is written (`canEdit`, TC-23).
    if (!editable) return;
    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;
    if (!press.dragging) {
      // Under the threshold it is still a press, not a drag (TC-19).
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      setDragging(true);
      // Once above everything it overlaps (sticky.move); a no-op when the
      // note is already topmost, so no pointless story-3 traffic (TC-10).
      bringToFront(docRef.current, idRef.current);
    }
    // Divide by zoom so the grabbed point stays under the pointer at any
    // zoom (sticky.move: 50%, 100%, 200%).
    const currentZoom = zoomRef.current;
    press.pending = {
      x: press.originX + dx / currentZoom,
      y: press.originY + dy / currentZoom,
    };
    scheduleFrame(press);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    pressRef.current = null;
    cancelFrame(press);
    const element = event.currentTarget;
    if (
      typeof element.releasePointerCapture === 'function' &&
      element.hasPointerCapture?.(event.pointerId)
    ) {
      element.releasePointerCapture(event.pointerId);
    }
    if (press.dragging) {
      applyPending(press); // the final position lands without waiting a frame
      setDragging(false);
    }
    // A short press without movement selects (sticky.select); a finished
    // drag ends in Selected too (interaction state diagram).
    onSelect(note.id);
  };

  const endInteraction = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // pointercancel / lost capture: keep the last applied position (TC-21).
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    pressRef.current = null;
    cancelFrame(press);
    press.pending = null;
    if (press.dragging) setDragging(false);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Never create a note on top of this one (TC-35): a double-click on a
    // note starts editing instead (sticky.edit_start).
    event.stopPropagation();
    if (editable && !editing) onStartEdit(note.id);
  };

  // Text fit: measure the (possibly hidden) text layer whenever the text
  // changes — zoom scales uniformly, so re-running per zoom is pointless.
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const box = STICKY_SIZE_WORLD - 2 * STICKY_TEXT_PADDING;
    const next = fitFontSize(element, box);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [note.text]);

  const ytext = getStickyText(doc, note.id);

  return (
    <div
      className="sticky-note"
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-color={note.color}
      data-x={note.x}
      data-y={note.y}
      data-z={note.z}
      tabIndex={0}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: STICKY_COLORS[note.color],
        zIndex: note.z,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endInteraction}
      onLostPointerCapture={endInteraction}
      onDoubleClick={onDoubleClick}
    >
      <div className="sticky-text-viewport">
        {/* Kept mounted while editing: it is what `fitFontSize` measures, and
            it shows the text of a note that is not being edited. */}
        <div
          ref={textRef}
          className="sticky-text"
          data-testid="sticky-text"
          aria-hidden={editing ? 'true' : undefined}
          style={{
            fontSize: `${fit.fontPx}px`,
            visibility: editing ? 'hidden' : 'visible',
          }}
        >
          {note.text}
        </div>
      </div>
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fit.fontPx}
          onEnd={onEndEdit}
        />
      ) : null}
      {fit.overflow ? <div className="text-fade" data-testid="text-fade" aria-hidden="true" /> : null}
      {selected && !editing && !dragging ? (
        // Screen space above the note: the inverse scale keeps the toolbar
        // the same size at any zoom, instead of scaling with the board.
        <div
          className="note-toolbar-anchor"
          style={{
            top: `${-(NOTE_TOOLBAR_HEIGHT_PX + NOTE_TOOLBAR_GAP_PX) / zoom}px`,
            transform: `scale(${1 / zoom})`,
          }}
        >
          <NoteToolbar
            color={note.color}
            disabled={!editable}
            onColor={(color) => {
              if (!editable) return;
              setStickyColor(doc, note.id, color);
            }}
            onDelete={() => {
              if (!editable) return;
              deleteObject(doc, note.id);
              onSelect(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
