// Story 2: one sticky note (anchor: sticky.interaction): render, select,
// drag to move, double-click to edit.
//
// Story 3: position, colour and text come from the shared Y.Doc snapshot, so
// remote changes re-render this note through the parent. Selection and
// editing are local props only.

import { useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
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
  DEFAULT_STICKY_COLOR,
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

/** Inner padding of the note in world units (kept for the font-fit box). */
const TEXT_PADDING_WORLD = 12;

interface DragState {
  pointerId: number;
  /** Pointer position at press, CSS px. */
  startX: number;
  startY: number;
  /** Note position at press, world units. */
  origX: number;
  origY: number;
  moved: boolean;
  pending: { x: number; y: number } | null;
  frame: number | null;
}

export function StickyNote(props: {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
}): JSX.Element {
  const { note, doc, zoom, selected, editing } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overflow, setOverflow] = useState(false);

  // Fit the text into the note (binary search, world-px font sizes). Runs on
  // mount, on text change and when the editor swaps in.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el === null) return;
    const fit = fitFontSize(el, STICKY_SIZE_WORLD - TEXT_PADDING_WORLD * 2);
    setOverflow(fit.overflow);
  }, [note.text, editing]);

  const flushPendingMove = (state: DragState): void => {
    if (state.frame !== null) {
      cancelAnimationFrame(state.frame);
      state.frame = null;
    }
    if (state.pending === null) return;
    const { x, y } = state.pending;
    state.pending = null;
    moveObject(doc, note.id, x, y);
  };

  const endDrag = (state: DragState | null): void => {
    if (state !== null) {
      flushPendingMove(state);
      if (state.frame !== null) {
        cancelAnimationFrame(state.frame);
        state.frame = null;
      }
      state.pending = null;
    }
    dragRef.current = null;
    setDragging(false);
  };

  // --- pointer: press -> select; beyond threshold -> drag ------------------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (editing) return; // the textarea owns pointer events while editing
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); // the board must not pan or create on a note press
    try {
      rootRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Capture can be unavailable (jsdom); the drag still works.
    }
    props.onSelect(note.id);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: note.x,
      origY: note.y,
      moved: false,
      pending: null,
      frame: null,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragging(true);
      bringToFront(doc, note.id);
    }
    drag.pending = { x: drag.origX + dx / zoom, y: drag.origY + dy / zoom };
    if (drag.frame === null) {
      drag.frame = requestAnimationFrame(() => {
        const state = dragRef.current;
        if (state === null || state.pending === null) return;
        state.frame = null;
        const { x, y } = state.pending;
        state.pending = null;
        // The note may have been deleted meanwhile: end the drag silently.
        if (!moveObject(doc, note.id, x, y)) endDrag(null);
      });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || e.pointerId !== drag.pointerId) return;
    try {
      rootRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Capture may already be released (pointercancel).
    }
    // Flush the last position so the grabbed point stays under the pointer.
    endDrag(drag);
  };

  const onPointerCancel = (): void => {
    // An interrupted drag keeps the note where it was last shown.
    const drag = dragRef.current;
    if (drag !== null) endDrag(null);
  };

  // --- keyboard and edit ----------------------------------------------------

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation(); // the board must not create a note on a note dblclick
    if (!editing) props.onStartEdit(note.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' && !editing) {
      e.preventDefault();
      props.onStartEdit(note.id);
    }
  };

  const color =
    note.color in STICKY_COLORS ? note.color : DEFAULT_STICKY_COLOR;

  const ytext = getStickyText(doc, note.id);

  return (
    <div
      ref={rootRef}
      className={`sticky-note${overflow ? ' has-fade' : ''}`}
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      data-color={note.color}
      data-selected={selected ? '' : undefined}
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[color],
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      {editing && ytext !== undefined ? (
        <StickyTextEditor
          ytext={ytext}
          textRef={textRef}
          rootRef={rootRef}
          onEnd={props.onEndEdit}
        />
      ) : (
        <div ref={(el) => void (textRef.current = el)} className="sticky-note__text">
          {note.text}
        </div>
      )}
      <div className="sticky-note__fade" aria-hidden="true" />
      {selected && !editing && !dragging && (
        <div
          className="note-toolbar-anchor"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div
            className="note-toolbar-scaled"
            style={{
              transform: `translate(-50%, -100%) scale(${1 / zoom})`,
            }}
          >
            <NoteToolbar
              color={color}
              onColor={(c) => {
                setStickyColor(doc, note.id, c);
              }}
              onDelete={() => {
                deleteObject(doc, note.id);
                props.onSelect(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
