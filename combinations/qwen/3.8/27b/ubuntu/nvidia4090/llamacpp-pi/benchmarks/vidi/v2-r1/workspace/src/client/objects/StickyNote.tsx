// StickyNote (story 2, sticky.interaction contract): render, select, drag,
// edit a single sticky note.
//
// Per-note interaction state (never stored in the document):
//   Unselected →(pointerdown)→ Pressed →(up < threshold)→ Selected
//   Pressed →(move ≥ DRAG_THRESHOLD_PX)→ Dragging →(up/cancel)→ Selected
//   Selected →(dblclick / Enter)→ Editing →(Escape)→ Selected
//   Editing →(click outside)→ Unselected
//
// Extra prop beyond the contract: `onDragChange` lets the parent (App) hide
// the note toolbar while a drag is in progress.

import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import {
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  STICKY_FONT_MAX_PX,
  DRAG_THRESHOLD_PX,
  DEFAULT_STICKY_COLOR,
} from '../../shared/config';
import {
  bringToFront,
  getStickyText,
  moveObject,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize, NOTE_TEXT_BOX } from './StickyText';
import { StickyTextEditor, type TextFit } from './StickyTextEditor';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom (screen px per world unit); drag deltas are divided by it. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Story 4 edit lock: while true the note can still be selected, but drag
   * (bringToFront/moveObject) and entering edit mode are no-ops.
   */
  disabled?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onDragChange?(dragging: boolean): void;
}

type Phase = 'idle' | 'pressed' | 'dragging';

interface PressStart {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  pointerId: number;
}

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, disabled = false, onSelect, onStartEdit, onEndEdit, onDragChange } = props;

  const [fit, setFit] = useState<TextFit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const displayRef = useRef<HTMLDivElement>(null);

  const phaseRef = useRef<Phase>('idle');
  const startRef = useRef<PressStart | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);

  // Latest props for use in unmount cleanup and rAF callbacks.
  const liveRef = useRef({ note, doc, zoom, onSelect, onDragChange });
  liveRef.current = { note, doc, zoom, onSelect, onDragChange };

  const scheduleMove = () => {
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) moveObject(liveRef.current.doc, liveRef.current.note.id, pending.x, pending.y);
    });
  };

  const cancelScheduled = () => {
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    pendingRef.current = null;
  };

  // If the note disappears from the document mid-interaction (deleted via the
  // model), end the interaction silently: no write, no exception, and the
  // parent's drag state is cleared.
  useEffect(
    () => () => {
      cancelScheduled();
      if (phaseRef.current !== 'idle') liveRef.current.onDragChange?.(false);
    },
    [],
  );

  const setPhase = (phase: Phase) => {
    phaseRef.current = phase;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // A note must never pan the board (sticky.no_pan): stop propagation so
    // the viewport's pan never starts.
    e.stopPropagation();
    if (editing) return; // the textarea owns the pointer while editing
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore: best-effort (jsdom).
      }
    }
    startRef.current = {
      screenX: e.clientX,
      screenY: e.clientY,
      worldX: note.x,
      worldY: note.y,
      pointerId: e.pointerId,
    };
    setPhase('pressed');
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    // Edit lock: a press can end in selection, but never in a drag.
    if (disabled) return;
    const dx = e.clientX - start.screenX;
    const dy = e.clientY - start.screenY;
    if (phaseRef.current === 'pressed' && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      setPhase('dragging');
      // The dragged note comes to the front, once.
      bringToFront(liveRef.current.doc, liveRef.current.note.id);
      liveRef.current.onDragChange?.(true);
    }
    if (phaseRef.current === 'dragging') {
      // Divide by the camera zoom so the grabbed point stays under the
      // pointer at any zoom level.
      pendingRef.current = {
        x: start.worldX + dx / zoom,
        y: start.worldY + dy / zoom,
      };
      scheduleMove();
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const start = startRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    startRef.current = null;
    const wasDragging = phaseRef.current === 'dragging';
    setPhase('idle');
    if (typeof e.currentTarget.releasePointerCapture === 'function') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore.
      }
    }
    if (wasDragging) {
      liveRef.current.onDragChange?.(false);
      if (cancelled) cancelScheduled(); // keep the last applied position
    }
    // A short press without movement selects; a finished or cancelled drag
    // ends in Selected at the last shown position.
    liveRef.current.onSelect(liveRef.current.note.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (editing || disabled) return;
    e.stopPropagation();
    onStartEdit(note.id);
  };

  // Display mode: fit the text into the note (largest size that fits).
  useLayoutEffect(() => {
    if (editing) return;
    const el = displayRef.current;
    if (!el) return;
    const next = fitFontSize(el, NOTE_TEXT_BOX);
    setFit((f) => (f.fontPx === next.fontPx && f.overflow === next.overflow ? f : next));
  }, [note.text, editing]);

  const color = STICKY_COLORS[note.color] ?? STICKY_COLORS[DEFAULT_STICKY_COLOR];
  const ytext = getStickyText(doc, note.id);

  return (
    <div
      className={
        'sticky-note' +
        (selected ? ' sticky-note--selected' : '') +
        (fit.overflow ? ' sticky-note--overflow' : '')
      }
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        // Visual stacking. DOM order is deliberately independent of z (see
        // App): moving the node when z changes would drop an active pointer
        // capture and abort an in-flight drag.
        zIndex: note.z,
        background: color,
      }}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-testid="sticky-note"
      data-id={note.id}
      {...(selected ? { 'data-selected': true } : {})}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finishDrag(e, false)}
      onPointerCancel={(e) => finishDrag(e, true)}
      onLostPointerCapture={(e) => finishDrag(e, true)}
      onDoubleClick={onDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} onFitChange={setFit} />
      ) : (
        <div ref={displayRef} className="sticky-note__text" style={{ fontSize: fit.fontPx }}>
          {note.text}
        </div>
      )}
      {fit.overflow && <div className="sticky-note__fade" data-testid="sticky-fade" />}
    </div>
  );
}
