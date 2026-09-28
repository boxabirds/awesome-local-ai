// A sticky note on the board (story 2, sticky.interaction): renders at its
// world position in the world layer, and owns the per-note interaction state
// machine — Unselected / Pressed / Selected / Dragging / Editing
// (selection and editing are local component state, never stored in the doc).

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
  getStickyText,
  moveObject,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import type { EditEnd } from '../board/useSelection';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

/** Padding (world px) between the note edge and its text. */
export const NOTE_PADDING_PX = 12;

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  pendingX: number;
  pendingY: number;
  raf: number | null;
}

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom at render time (drag deltas are divided by it). */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EditEnd): void;
  /** Reports the drag state so App can hide the note toolbar while dragging. */
  onDraggingChange?(dragging: boolean): void;
  /** Story 4 (persist.client_status): while the board is locked (load
   *  failed) dragging and text editing are no-ops; selection stays allowed
   *  so the locked state is visible on the note. */
  locked?: boolean;
}

export function StickyNote(props: StickyNoteProps): ReactElement {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit, onDraggingChange, locked } = props;
  const ref = useRef<HTMLDivElement>(null);
  const textElRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [dragging, setDragging] = useState(false);

  // Font auto-fit: measure on mount and whenever the text changes (the
  // snapshot updates on every text edit). Zoom scales the world uniformly,
  // so no re-measure is needed on zoom.
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });
  useEffect(() => {
    const el = textElRef.current;
    if (!el) return;
    setFit(fitFontSize(el, STICKY_SIZE_WORLD - 2 * NOTE_PADDING_PX));
  }, [note.text, editing]);

  // Cancel a pending drag flush if the note is unmounted mid-drag.
  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (drag && drag.raf !== null) cancelAnimationFrame(drag.raf);
    },
    [],
  );

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.raf !== null) {
      cancelAnimationFrame(drag.raf);
      // Flush the last shown position (pointer release/cancel outside the
      // window keeps the note where it was last applied).
      moveObject(doc, note.id, drag.pendingX, drag.pendingY);
    }
    const el = ref.current;
    if (el && el.hasPointerCapture(drag.pointerId)) el.releasePointerCapture(drag.pointerId);
    setDragging(false);
    onDraggingChange?.(false);
  }, [doc, note.id, onDraggingChange]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // The board must never pan while interacting with a note.
    e.stopPropagation();
    if (editing) return; // the textarea owns the pointer while editing
    onSelect(note.id);
    if (locked) return; // load-failed: selection only, no drag, no doc writes
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWorldX: note.x,
      startWorldY: note.y,
      pendingX: note.x,
      pendingY: note.y,
      raf: null,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // stay Pressed
    if (!dragging) {
      setDragging(true);
      onDraggingChange?.(true);
      bringToFront(doc, note.id); // once, when the drag starts
    }
    drag.pendingX = drag.startWorldX + dx / zoomRef.current;
    drag.pendingY = drag.startWorldY + dy / zoomRef.current;
    if (drag.raf === null) {
      // Throttle doc writes to one per animation frame.
      drag.raf = requestAnimationFrame(() => {
        drag.raf = null;
        if (dragRef.current !== drag) return; // finished in the meantime
        const applied = moveObject(doc, note.id, drag.pendingX, drag.pendingY);
        if (!applied) finishDrag(); // note deleted mid-drag (stale id)
      });
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation(); // editing the note, never creating a new one
    if (locked) return; // load-failed: no text editing
    onStartEdit(note.id);
  };

  const ytext = getStickyText(doc, note.id);

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-id={note.id}
      data-selected={selected ? 'true' : undefined}
      data-editing={editing ? 'true' : undefined}
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}${dragging ? ' sticky-note--dragging' : ''}`}
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow,
        ['--sticky-bg' as string]: STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        if (!selected) onSelect(note.id); // Tab-reachable notes are selectable
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textElRef}
          data-testid="sticky-note-text"
          className={`sticky-note-text${fit.overflow ? ' sticky-note-fade' : ''}`}
          style={{ fontSize: fit.fontPx }}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}
