// A sticky note on the board (see spec: sticky.interaction).
//
// Rendered in world space (scales with zoom). Handles: selection, drag-to-move
// (with pointer capture, rAF-throttled, delta divided by zoom), double-click
// to edit, and per-note text display with auto-fit. If the note disappears
// from the document mid-interaction (stale id), the interaction ends silently.

import { useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { getStickyText, moveObject, bringToFront, type StickySnapshot } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom at render time; drag deltas are divided by it. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** True while this note is being dragged (App hides the note toolbar). */
  onDraggingChange(id: string | null): void;
}

interface DragState {
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  startWorldX: number;
  startWorldY: number;
  phase: 'pressed' | 'dragging';
  pendingX: number | null;
  pendingY: number | null;
  raf: number | null;
  /** A real drag (>= threshold) started; only then do we notify on end. */
  dragStarted: boolean;
}

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit, onDraggingChange } = props;
  const noteRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  // Auto-fit in display mode: on mount and on every text change (not on zoom).
  useEffect(() => {
    const el = textRef.current;
    if (el === null) return;
    setFit(fitFontSize(el, STICKY_SIZE_WORLD));
  }, [note.text, editing]);

  // bringToFront reorders the DOM on the first drag move; moving a node
  // temporarily removes it, which makes the browser release the pointer
  // capture. Re-acquire it after the commit so the drag keeps receiving
  // pointer events even when the pointer outruns the note.
  useEffect(() => {
    if (!dragging) return;
    const drag = dragRef.current;
    if (drag === null) return;
    try {
      noteRef.current?.setPointerCapture(drag.pointerId);
    } catch {
      // jsdom has no pointer capture; the drag still works.
    }
  }, [dragging]);

  const applyPendingMove = () => {
    const drag = dragRef.current;
    if (drag === null || drag.raf === null) return;
    drag.raf = null;
    if (drag.pendingX === null || drag.pendingY === null) return;
    const ok = moveObject(doc, note.id, drag.pendingX, drag.pendingY);
    drag.pendingX = null;
    drag.pendingY = null;
    if (!ok) {
      // Note deleted mid-drag: end the interaction silently (TC-37).
      const started = drag.dragStarted;
      dragRef.current = null;
      if (started) {
        setDragging(false);
        onDraggingChange(null);
      }
    }
  };

  const endDrag = (flush: boolean) => {
    const drag = dragRef.current;
    if (drag === null) return;
    if (drag.dragStarted) setDragging(false);
    if (drag.raf !== null) {
      cancelAnimationFrame(drag.raf);
      drag.raf = null;
    }
    if (flush && drag.pendingX !== null && drag.pendingY !== null) {
      // Land the note exactly where the pointer released it.
      if (!moveObject(doc, note.id, drag.pendingX, drag.pendingY)) {
        const started = drag.dragStarted;
        dragRef.current = null;
        if (started) onDraggingChange(null);
        return;
      }
    }
    const started = drag.dragStarted;
    dragRef.current = null;
    if (started) onDraggingChange(null);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // The board must not pan when a drag starts on a note (sticky.no_pan).
    event.stopPropagation();
    if (!selected) onSelect(note.id);
    try {
      noteRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // jsdom has no pointer capture; the drag still works.
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startScreenX: event.clientX,
      startScreenY: event.clientY,
      startWorldX: note.x,
      startWorldY: note.y,
      phase: 'pressed',
      pendingX: null,
      pendingY: null,
      raf: null,
      dragStarted: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - drag.startScreenX;
    const dy = event.clientY - drag.startScreenY;
    if (drag.phase === 'pressed') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.phase = 'dragging';
      drag.dragStarted = true;
      setDragging(true);
      // The note under the pointer comes to the front (once, at drag start).
      bringToFront(doc, note.id);
      onDraggingChange(note.id);
    }
    drag.pendingX = drag.startWorldX + dx / zoom;
    drag.pendingY = drag.startWorldY + dy / zoom;
    if (drag.raf === null) {
      drag.raf = requestAnimationFrame(applyPendingMove);
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    try {
      noteRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    endDrag(true);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    // Interrupted drag: the note stays where it was last shown.
    endDrag(false);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    onStartEdit(note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={noteRef}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-id={note.id}
      data-dragging={dragging ? 'true' : 'false'}
      data-selected={selected || undefined}
      tabIndex={0}
      className="sticky-note"
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: STICKY_COLORS[note.color],
        ['--sticky-bg' as string]: STICKY_COLORS[note.color],
        pointerEvents: 'auto',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        if (!selected) onSelect(note.id);
      }}
    >
      {editing && ytext !== undefined ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : (
        <>
          <div
            ref={textRef}
            data-testid="sticky-text"
            className="sticky-text"
            style={{ fontSize: fit.fontPx }}
          >
            {note.text}
          </div>
          {fit.overflow && (
            <div data-testid="sticky-fade" className="sticky-fade" aria-hidden="true" />
          )}
        </>
      )}
    </div>
  );
}
