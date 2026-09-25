import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import {
  bringToFront,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';

/**
 * One sticky note: the read-only face, the text editor and the pointer state
 * machine of a single note.
 *
 * The state machine from the design (Unselected, Pressed, Selected, Dragging,
 * Editing) lives here and is *local*: it is never written to the Y.Doc,
 * because another user must not see my selection as board data.
 *
 * `data-board-object` marks the note as "not empty board surface", which is
 * how BoardViewport decides whether a pointer belongs to the board. The note
 * also stops pointer propagation, so dragging a note can never pan the board.
 */

/** Padding between the note edge and its text, in world units. */
const TEXT_PADDING_WORLD = 12;

/** Height available to the text, used by the font auto-fit. */
const TEXT_BOX_WORLD = STICKY_SIZE_WORLD - TEXT_PADDING_WORLD * 2;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** The bin button: removes the note and clears the selection. */
  onDelete(id: string): void;
}

/** Where a pointer press on this note currently is. Null means no press. */
interface DragState {
  pointerId: number;
  /** True once the pointer travelled further than DRAG_THRESHOLD_PX. */
  moving: boolean;
  startX: number;
  startY: number;
  /** Note corner when the press started, in world units. */
  originX: number;
  originY: number;
  /** Position requested but not applied yet (waiting for the next frame). */
  pending: { x: number; y: number } | null;
  frame: number | null;
}

/** One move per animation frame, whatever the pointer device reports. */
function scheduleFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

function isNoteUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-note-ui]') !== null;
}

function StickyNoteView(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing } = props;
  const id = note.id;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [dragging, setDragging] = useState<boolean>(false);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  // The listeners below are bound once per note; they read the current props
  // through this ref instead of being rebound on every render.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const stopTracking = (): void => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    /** Watch the window for the rest of this gesture (see the note below). */
    const startTracking = (): void => {
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onCancel);
    };

    /** Leave the drag: either apply the last position or freeze the last one. */
    const endDrag = (applyLastPosition: boolean): void => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      stopTracking();      if (drag.frame !== null) {
        cancelFrame(drag.frame);
        drag.frame = null;
      }
      const pending = drag.pending;
      drag.pending = null;
      if (applyLastPosition && pending) moveObject(doc, id, pending.x, pending.y);
      if (drag.moving) setDragging(false);
      // Releasing a press selects the note (PRD: a short press without
      // movement selects it).
      latest.current.onSelect(id);
    };

    const onPointerDown = (event: PointerEvent): void => {
      // Mouse only, like the board itself (see touch-action in styles.css): a
      // touch press is left alone rather than turned into a half-drag.
      if (event.button !== 0 || event.pointerType !== 'mouse') return;
      // A note owns its pointer: no board pan, and no note created underneath.
      event.stopPropagation();
      const state = latest.current;
      if (state.editing) return; // its body is the textarea while editing
      if (isNoteUi(event.target)) return; // the note toolbar, not the note body
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is a bonus: the drag is tracked on window anyway.
      }
      dragRef.current = {
        pointerId: event.pointerId,
        moving: false,
        startX: event.clientX,
        startY: event.clientY,
        originX: state.note.x,
        originY: state.note.y,
        pending: null,
        frame: null,
      };
      // Stops the browser's native text selection while dragging.
      event.preventDefault();
      // From here on the window is watched, not just the note: a fast drag
      // leaves the 200-pixel square within one frame, and a note that loses
      // the pointer mid-drag would end up somewhere the user never pointed.
      // Pointer capture is asked for too, but it is not trusted: Chromium
      // gives it up as soon as another note ends up under the cursor.
      startTracking();
    };

    const onPointerMove = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.buttons === 0) {
        // The release was never reported - the pointer left the window with the
        // button down. Drop the drag instead of following an unheld pointer.
        dragRef.current = null;
        stopTracking();
        if (drag.moving) setDragging(false);
        return;
      }
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (!drag.moving) {
        // Below the threshold the press is still a press, so a shaky click
        // cannot nudge a note.
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.moving = true;
        setDragging(true);
        // Whatever it overlaps while being dragged, it overlaps from above.
        bringToFront(doc, id);
      }

      // Screen pixels are world units times the zoom: dividing by the zoom is
      // what keeps the grabbed point under the pointer at any zoom level.
      const zoomNow = latest.current.zoom > 0 ? latest.current.zoom : 1;
      drag.pending = { x: drag.originX + dx / zoomNow, y: drag.originY + dy / zoomNow };

      if (drag.frame === null) {
        drag.frame = scheduleFrame(() => {
          drag.frame = null;
          if (dragRef.current !== drag) return;
          const target = drag.pending;
          drag.pending = null;
          if (!target) return;
          // A note deleted mid-drag ends the interaction silently (TC-37).
          if (!moveObject(doc, id, target.x, target.y)) dragRef.current = null;
        });
      }
    };

    const onPointerUp = (): void => {
      endDrag(true);
    };

    /** Cancelled or lost: the note stays where it was last shown. */
    const onCancel = (): void => {
      endDrag(false);
    };

    const onDoubleClick = (event: MouseEvent): void => {
      event.stopPropagation();
      if (isNoteUi(event.target)) return;
      const state = latest.current;
      if (state.editing) return;
      state.onStartEdit(id);
      event.preventDefault();
    };

    /** Keyboard users reach a note with Tab; focus selects it. */
    const onFocus = (): void => {
      const state = latest.current;
      if (state.editing) return;
      state.onSelect(id);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('dblclick', onDoubleClick);
    el.addEventListener('focus', onFocus);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('dblclick', onDoubleClick);
      el.removeEventListener('focus', onFocus);
      stopTracking();
      const drag = dragRef.current;
      if (drag?.frame !== null && drag?.frame !== undefined) cancelFrame(drag.frame);
      dragRef.current = null;
    };
  }, [doc, id]);

  // Auto-fit: measure the rendered text and shrink it until it fits. Only when
  // the text or the mode changes - the font is in world units, so zoom scales
  // it uniformly and needs no remeasuring.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const fitted = fitFontSize(el, TEXT_BOX_WORLD);
    setFit((previous) =>
      previous.fontPx === fitted.fontPx && previous.overflow === fitted.overflow
        ? previous
        : fitted,
    );
  }, [note.text, editing]);

  const handleColor = useCallback(
    (color: StickyColor) => {
      setStickyColor(doc, id, color);
    },
    [doc, id],
  );

  const ytext = editing ? getStickyText(doc, id) : undefined;

  return (
    <div
      ref={rootRef}
      className="sticky-note"
      data-testid="sticky-note"
      data-board-object="sticky"
      data-note-id={id}
      data-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        padding: `${TEXT_PADDING_WORLD}px`,
        backgroundColor: STICKY_COLORS[note.color],
        // The selected note (and its toolbar) must draw over its neighbours.
        zIndex: selected ? 2 : 1,
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fit.fontPx}
          box={TEXT_BOX_WORLD}
          onEnd={props.onEndEdit}
        />
      ) : (
        <div
          ref={textRef}
          className="sticky-note__text"
          data-testid="sticky-note-text"
          style={{ fontSize: `${fit.fontPx}px` }}
        >
          {note.text}
        </div>
      )}

      {editing ? null : (
        <>
          {fit.overflow ? (
            <div
              className="sticky-note__fade"
              data-testid="sticky-note-fade"
              aria-hidden="true"
            />
          ) : null}
        </>
      )}

      {selected && !editing && !dragging ? (
        <NoteToolbar
          color={note.color}
          zoom={zoom}
          onColor={handleColor}
          onDelete={() => {
            props.onDelete(id);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Memoised so a drag (which rewrites the dragged note only) re-renders one
 * note instead of the whole board.
 */
export const StickyNote = memo(StickyNoteView);
