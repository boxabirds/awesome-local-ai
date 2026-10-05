import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';

import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import type { EndEditNext } from '../board/useSelection';
import { fitFontSize } from './StickyText';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';

/** Inside of a note, in world units: the box the text has to fit into. */
export const STICKY_CONTENT_SIZE = STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD;

/** Interaction state of one note; `Editing` comes from the `editing` prop. */
export type NoteInteraction = 'unselected' | 'pressed' | 'selected' | 'dragging' | 'editing';

export interface StickyNoteProps {
  note: StickySnapshot;
  /** The shared document this note lives in. */
  doc: Y.Doc;
  /** Camera zoom: screen pixels per world unit, used to keep the grabbed point under the pointer. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
  /** Called after this note was deleted through the toolbar's bin button. */
  onDeleted?(id: string): void;
}

interface DragState {
  pointerId: number;
  /** Screen point where the press started. */
  startClientX: number;
  startClientY: number;
  /** Note position when the press started. */
  originX: number;
  originY: number;
  /** Latest screen point seen. */
  lastClientX: number;
  lastClientY: number;
  /** True once the pointer moved at least `DRAG_THRESHOLD_PX`. */
  dragging: boolean;
  /** Pending requestAnimationFrame id, or null. */
  frame: number | null;
  /** True when the latest pointer position has not been written yet. */
  dirty: boolean;
}

/**
 * One sticky note: rendered, selectable, draggable and editable.
 *
 * The note is a `div[role="group"][aria-label="Sticky note"]` positioned at its
 * world coordinates inside the world layer, so it scales and moves with the
 * board. Pressing it stops propagation, so the board never pans while a note is
 * dragged; movement past `DRAG_THRESHOLD_PX` restacks the note and then writes
 * its position once per animation frame, dividing the screen delta by the camera
 * zoom so the grabbed point stays under the pointer at 50 %, 100 % or 200 %.
 */
export function StickyNote(props: StickyNoteProps): React.JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit, onDeleted } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const zoomRef = useRef(zoom);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });
  // Which state a note is in comes from props (selected, editing) and from the
  // drag session. The transient Pressed state exists only inside that session,
  // so re-render when it opens and closes to keep `data-interaction` truthful.
  const [, setPressRender] = useState(0);
  const rerenderPressState = useCallback(() => setPressRender((count) => count + 1), []);

  zoomRef.current = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  /** True while the note still exists in the document. */
  const exists = useCallback((): boolean => getStickyText(doc, note.id) !== undefined, [doc, note.id]);

  const cancelFrame = useCallback(() => {
    const state = dragRef.current;
    if (state?.frame !== null && state?.frame !== undefined) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.frame);
      state.frame = null;
    }
  }, []);

  // Auto-fit: measure on mount and whenever the text changes. Zoom scales the
  // whole note uniformly, so the font size in world units does not depend on it.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const next = fitFontSize(el, STICKY_CONTENT_SIZE);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [note.text]);

  // The note can disappear under us (deleted by somebody else): stop interacting.
  useEffect(() => {
    if (!exists()) {
      cancelFrame();
      dragRef.current = null;
      if (dragging) setDragging(false);
    }
  }, [dragging, exists, note.id, note.x, note.y]);

  // Never leave a queued frame running after unmount.
  useEffect(() => cancelFrame, [cancelFrame]);

  /** Writes the pending position once; silently stops if the note is gone. */
  const writePosition = useCallback(() => {
    const state = dragRef.current;
    if (!state) return;
    state.frame = null;
    if (!state.dirty) return;
    state.dirty = false;
    if (!exists()) return; // deleted mid-drag: end without a write
    const scale = zoomRef.current;
    const dx = (state.lastClientX - state.startClientX) / scale;
    const dy = (state.lastClientY - state.startClientY) / scale;
    moveObject(doc, note.id, state.originX + dx, state.originY + dy);
  }, [doc, exists, note.id]);

  const scheduleWrite = useCallback(() => {
    const state = dragRef.current;
    if (!state || state.frame !== null) return; // at most one write per frame
    if (typeof requestAnimationFrame !== 'function') {
      writePosition();
      return;
    }
    state.frame = requestAnimationFrame(() => writePosition());
  }, [writePosition]);

  /** Ends a drag: flushes the last shown position and selects the note. */
  const finishDrag = useCallback(() => {
    const state = dragRef.current;
    if (!state) return;
    if (state.frame !== null) cancelFrame(); // dragRef is still set, so this really cancels
    if (state.dragging) {
      writePosition(); // the position the pointer last showed is the position that is kept
      setDragging(false);
    }
    dragRef.current = null; // only now: writePosition reads the session back
    rerenderPressState();
  }, [cancelFrame, rerenderPressState, writePosition]);

  const releaseCapture = (pointerId: number) => {
    const el = ref.current;
    try {
      if (el?.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      // jsdom and some embedded browsers do not implement pointer capture.
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A press on a note belongs to the note: the board must not pan.
    event.stopPropagation();
    if (editing) return; // clicking inside the editor edits text, not the note
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
    const el = ref.current;
    try {
      el?.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore: no pointer capture support
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: note.x,
      originY: note.y,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      dragging: false,
      frame: null,
      dirty: false,
    };
    rerenderPressState();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    // The note owns this pointer: never let the board pan.
    event.stopPropagation();
    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
    if (!state.dragging) {
      const dx = event.clientX - state.startClientX;
      const dy = event.clientY - state.startClientY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a press, not a drag
      state.dragging = true;
      // Once, at the start of the drag: come to the front of everything.
      bringToFront(doc, note.id);
      setDragging(true);
    }
    state.dirty = true;
    scheduleWrite();
  };

  /**
   * While a drag is running the pointer is followed on the window, in the capture
   * phase: the note's own node is moved when it comes to the front (which drops
   * pointer capture), the pointer can leave the note's box, and the note stops the
   * event from bubbling so the board never pans. Positions are written per frame.
   */
  useEffect(() => {
    if (!dragging) return undefined;
    const onWindowPointerMove = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state || !state.dragging || state.pointerId !== event.pointerId) return;
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      state.lastClientX = event.clientX;
      state.lastClientY = event.clientY;
      state.dirty = true;
      scheduleWrite();
    };
    const onWindowPointerEnd = (event: PointerEvent) => {
      if (!dragRef.current) return;
      if (dragRef.current.pointerId === event.pointerId) releaseCapture(event.pointerId);
      // pointerup selects; pointercancel keeps the last applied position.
      finishDrag();
      if (exists()) onSelect(note.id);
    };
    window.addEventListener('pointermove', onWindowPointerMove, true);
    window.addEventListener('pointerup', onWindowPointerEnd, true);
    window.addEventListener('pointercancel', onWindowPointerEnd, true);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove, true);
      window.removeEventListener('pointerup', onWindowPointerEnd, true);
      window.removeEventListener('pointercancel', onWindowPointerEnd, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, exists, finishDrag, note.id, scheduleWrite]);

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state) return;
    const mine = state.pointerId === event.pointerId;
    if (mine) event.stopPropagation();
    releaseCapture(mine ? event.pointerId : state.pointerId);
    // pointerup selects; pointercancel keeps the last applied position.
    finishDrag();
    if (exists()) onSelect(note.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A double-click on a note edits it; the board must not create a new note.
    event.stopPropagation();
    if (!editing) onStartEdit(note.id);
  };

  const pickColor = (color: StickyColor) => {
    // Only the colour changes: text, position, stacking and selection stay put.
    setStickyColor(doc, note.id, color);
  };

  const remove = () => {
    if (deleteObject(doc, note.id)) onDeleted?.(note.id);
  };

  const interaction: NoteInteraction = editing
    ? 'editing'
    : dragging
      ? 'dragging'
      : dragRef.current
        ? 'pressed'
        : selected
          ? 'selected'
          : 'unselected';

  return (
    <div
      aria-label="Sticky note"
      className="sticky-note"
      data-color={note.color}
      data-font-px={fit.fontPx}
      data-interaction={interaction}
      data-note-id={note.id}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-selected={selected ? 'true' : undefined}
      data-testid="sticky-note"
      data-x={note.x}
      data-y={note.y}
      data-z={note.z}
      ref={ref}
      role="group"
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[note.color],
        // One source of truth for the note's inner padding: the CSS uses this
        // variable for the text box, the editor and the fade.
        '--sticky-pad': `${STICKY_PADDING_WORLD}px`,
      } as React.CSSProperties}
      tabIndex={0}
      onDoubleClick={onDoubleClick}
      onPointerCancel={onPointerEnd}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
    >
      {/* Hidden mirror of the text box, used to measure the largest font that fits. */}
      <div
        aria-hidden="true"
        className="sticky-measure"
        data-testid={`sticky-measure-${note.id}`}
        ref={measureRef}
        style={{ width: STICKY_CONTENT_SIZE, height: STICKY_CONTENT_SIZE }}
      >
        {note.text}
      </div>
      {editing ? (
        <StickyTextEditor
          fontPx={fit.fontPx}
          key={note.id}
          onEnd={onEndEdit}
          ytext={sharedText(doc, note.id)}
        />
      ) : (
        <div
          className="sticky-text"
          data-testid="sticky-text"
          style={{ fontSize: `${fit.fontPx}px` }}
        >
          {note.text}
        </div>
      )}
      {fit.overflow ? <div aria-hidden="true" className="sticky-overflow-fade" data-testid="sticky-overflow-fade" /> : null}
      {selected && !dragging && !editing ? (
        <NoteToolbar color={note.color} onColor={pickColor} onDelete={remove} />
      ) : null}
    </div>
  );
}

/** The note's shared text; a note deleted mid-edit falls back to a throwaway `Y.Text`. */
function sharedText(doc: Y.Doc, id: string): Y.Text {
  return getStickyText(doc, id) ?? new Y.Text();
}
