import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import * as Y from 'yjs';
import { deleteObject, getStickyText, hasObject, moveObject, bringToFront, setStickyColor } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import type { FontFit } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom (screen px per world unit); drag deltas are divided by it. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

interface DragState {
  startClientX: number;
  startClientY: number;
  /** Note top-left in world units when the press started. */
  originX: number;
  originY: number;
  /** True once the pointer moved beyond DRAG_THRESHOLD_PX. */
  dragging: boolean;
  rafId: number | null;
  pending: { x: number; y: number } | null;
}

const stopEvent = (e: { stopPropagation(): void }): void => {
  e.stopPropagation();
};

/**
 * One sticky note in the world layer.
 *
 * Interaction states (per note, local only — never written to the doc):
 * Unselected -> Pressed (pointerdown) -> Selected (up within threshold) or
 * Dragging (moved beyond DRAG_THRESHOLD_PX); Selected -> Editing (dblclick
 * or Enter from App); Editing -> Selected (Escape) / Unselected (click
 * outside). Dragging divides pointer deltas by the camera zoom, throttles
 * `moveObject` with requestAnimationFrame and calls `bringToFront` once when
 * the drag starts, so the grabbed point stays under the pointer at any zoom
 * and the board never pans (pointerdown stops propagation).
 */
export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<FontFit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // --- font fit: measure the text at the note's content width -------------
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    setFit(fitFontSize(el, el.clientHeight));
  }, [note.text, editing]);

  // A note deleted mid-drag must not leave a pending rAF write (TC-37).
  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (drag && drag.rafId !== null) cancelAnimationFrame(drag.rafId);
    },
    [],
  );

  // While editing, a pointerdown anywhere outside the note ends editing
  // (unselected). Capture phase on window: runs before focus moves.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: Event): void => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        onEndEdit('unselected');
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, onEndEdit]);

  // --- pointer: press / drag / release -------------------------------------

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation(); // the board must not pan (sticky.no_pan)
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: note.x,
      originY: note.y,
      dragging: false,
      rafId: null,
      pending: null,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.dragging) {
      // Below the threshold this is still a press, not a drag.
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      setDragging(true);
      onSelect(note.id);
      bringToFront(doc, note.id); // already-on-top returns false: that is fine
      if (!hasObject(doc, note.id)) {
        endDrag(); // the note disappeared meanwhile (stale id)
        return;
      }
    }
    const pending = { x: drag.originX + dx / zoom, y: drag.originY + dy / zoom };
    drag.pending = pending;
    if (drag.rafId === null) {
      drag.rafId = requestAnimationFrame(() => {
        const cur = dragRef.current;
        if (!cur || cur.rafId === null) return;
        cur.rafId = null;
        if (!cur.pending) return;
        const applied = moveObject(doc, note.id, cur.pending.x, cur.pending.y);
        if (!applied) endDrag(); // deleted mid-drag: stop silently (TC-37)
      });
    }
  };

  const endDrag = (): void => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.rafId !== null) cancelAnimationFrame(drag.rafId);
    // Flush the last pointer position so the note ends where it was last shown.
    if (drag.dragging && drag.pending) moveObject(doc, note.id, drag.pending.x, drag.pending.y);
    setDragging(false);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    endDrag();
    // A press without movement selects the note (also after a drag).
    if (!editing) onSelect(note.id);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // Note: no onLostPointerCapture handler. Chrome fires lostpointercapture
  // when the captured element is moved in the DOM (React reorders the notes
  // by z when bringToFront runs mid-drag), which would kill a valid drag.
  // A stale dragRef is harmless: the next pointerdown replaces it, and the
  // unmount cleanup cancels any pending frame.

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation(); // never create a note under an existing one (TC-35)
    if (!editing) onStartEdit(note.id);
  };

  // --- rendering -----------------------------------------------------------

  const color = STICKY_COLORS[note.color] ?? STICKY_COLORS[DEFAULT_STICKY_COLOR];
  const text = getStickyText(doc, note.id);
  const rootClass = [
    'vidi6-sticky',
    selected ? 'vidi6-sticky--selected' : null,
    dragging ? 'vidi6-sticky--dragging' : null,
    fit.overflow ? 'vidi6-sticky--overflow' : null,
  ]
    .filter(Boolean)
    .join(' ');
  const rootStyle: CSSProperties & Record<'--sticky-color', string> = {
    left: note.x,
    top: note.y,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    backgroundColor: color,
    '--sticky-color': color,
  };

  return (
    <div
      ref={rootRef}
      className={rootClass}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      style={rootStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        // Tab focus makes the note selectable so Enter can start editing.
        if (!selected && !editing) onSelect(note.id);
      }}
    >
      {/* Hidden measurement twin: same font, width and wrapping as the display text. */}
      <div ref={measureRef} className="vidi6-sticky__measure" aria-hidden="true">
        {note.text}
      </div>

      {editing && text !== undefined ? (
        <StickyTextEditor ytext={text} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          className="vidi6-sticky__text"
          style={{
            fontSize: `${fit.fontPx}px`,
            alignItems: fit.overflow ? 'flex-start' : 'center',
          }}
        >
          {note.text}
        </div>
      )}

      {fit.overflow && <div className="vidi6-sticky__fade" aria-hidden="true" />}

      {selected && !editing && !dragging && (
        <div
          className="vidi6-sticky__toolbar"
          // Unscaled into screen space: the note is scaled by `zoom` in the
          // world layer, so scale the toolbar by 1/zoom around its bottom
          // centre to keep it a constant screen size above the note.
          style={{ transform: `translate(-50%, -100%) scale(${1 / zoom})` }}
          onPointerDown={stopEvent}
          onPointerUp={stopEvent}
          onPointerCancel={stopEvent}
          onDoubleClick={stopEvent}
          onClick={stopEvent}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c) => {
              setStickyColor(doc, note.id, c);
            }}
            onDelete={() => {
              if (deleteObject(doc, note.id)) onEndEdit('unselected');
            }}
          />
        </div>
      )}
    </div>
  );
}
