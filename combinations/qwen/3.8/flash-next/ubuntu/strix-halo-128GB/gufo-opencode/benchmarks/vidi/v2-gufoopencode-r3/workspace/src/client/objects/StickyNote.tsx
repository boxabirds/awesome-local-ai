import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD
} from '../../shared/config';
import {
  bringToFront,
  getStickyText,
  moveObject,
  type StickySnapshot
} from '../../shared/board-model';
import { fitFontSize, type EndEditNext } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

export const STICKY_PADDING_WORLD = 16;
const TEXT_BOX = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
  // Optional local-only signal so the floating toolbar can hide while dragging.
  onDraggingChange?(id: string | null): void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  moved: boolean;
  raf: number | null;
  pending: { x: number; y: number } | null;
}

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // Auto-fit: run on mount and whenever the text changes; zoom scales the
  // world layer uniformly so the board-unit font size needs no per-zoom pass.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (el === null) return;
    el.textContent = note.text;
    const next = fitFontSize(el, TEXT_BOX);
    setFit((prev) =>
      prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next
    );
  }, [note.text]);

  useEffect(
    () => () => {
      // Unmount mid-drag (e.g. note deleted, TC-37): drop pending writes.
      const d = dragRef.current;
      if (d !== null && d.raf !== null) cancelAnimationFrame(d.raf);
      dragRef.current = null;
    },
    []
  );

  // Applies the latest queued pointer position. Shared by the rAF pump and
  // release so a release in the same frame as a move never drops it.
  const applyPending = (cur: DragState): boolean => {
    if (cur.pending === null) return false;
    const { x, y } = cur.pending;
    cur.pending = null;
    moveObject(doc, note.id, x, y);
    // Note deleted mid-drag: end the interaction silently (TC-37).
    return getStickyText(doc, note.id) === undefined;
  };

  const endDrag = (reselect: boolean, flush: boolean) => {
    const d = dragRef.current;
    if (d === null) return;
    if (d.raf !== null) cancelAnimationFrame(d.raf);
    dragRef.current = null;
    // pointercancel freezes at the last applied position; release keeps the
    // final pending position.
    if (flush) applyPending(d);
    props.onDraggingChange?.(null);
    if (reselect) onSelect(note.id);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Never let the viewport see this: dragging a note must not pan (TC-20).
    e.stopPropagation();
    if (editing) return; // the textarea owns interaction while editing
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom lacks pointer capture; events still reach this element.
    }
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: note.x,
      origY: note.y,
      moved: false,
      raf: null,
      pending: null
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d === null || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // stay Pressed
      d.moved = true;
      bringToFront(doc, note.id);
      props.onDraggingChange?.(note.id);
    }
    // Divide by camera zoom so the grabbed point stays under the pointer.
    d.pending = { x: d.origX + dx / zoomRef.current, y: d.origY + dy / zoomRef.current };
    if (d.raf === null) {
      d.raf = requestAnimationFrame(() => {
        const cur = dragRef.current;
        if (cur === null) return;
        cur.raf = null;
        if (applyPending(cur)) {
          dragRef.current = null;
          props.onDraggingChange?.(null);
        }
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    endDrag(true, true);
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // Keep the last applied position; the note ends as Selected.
    endDrag(true, false);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Editing an existing note instead of creating a new one (TC-35).
    e.stopPropagation();
    if (!editing) onStartEdit(note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const showEditor = editing && ytext !== undefined;

  return (
    <div
      ref={rootRef}
      data-testid="sticky-note"
      data-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      className={`sticky-note${fit.overflow ? ' sticky-note--overflow' : ''}`}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[note.color]
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={() => endDrag(true, true)}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={measureRef}
        className="sticky-note-measure"
        style={{ width: TEXT_BOX }}
        aria-hidden="true"
      />
      {showEditor ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : (
        <div className="sticky-note-text">
          <div className="sticky-note-text-inner" style={{ fontSize: fit.fontPx }}>
            {note.text}
          </div>
        </div>
      )}
    </div>
  );
}
