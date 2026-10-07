import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
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
import { fitFontSize, STICKY_TEXT_BOX_WORLD, type FontFit } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';



export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, so a drag keeps the grabbed point under the pointer. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

interface Press {
  pointerId: number;
  /** Pointer position at press, in screen pixels. */
  startX: number;
  startY: number;
  /** Note position at press, in world units. */
  originX: number;
  originY: number;
}

/**
 * One sticky note: rendering, selection, drag-to-move, double-click-to-edit and
 * its floating toolbar. The interaction follows the per-note state machine
 * Unselected -> Pressed -> Selected | Dragging (+ Editing), all of it local:
 * only position, colour, text and stacking ever reach the document.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<FontFit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // Latest props for the native listeners (attached once per note).
  const live = useRef({ note, zoom, editing, onSelect, onStartEdit });
  live.current = { note, zoom, editing, onSelect, onStartEdit };

  // ---------------------------------------------------------------- font fit
  // Measured on mount and whenever the text changes; zoom scales the whole note
  // uniformly, so it cannot change which size fits.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el, STICKY_TEXT_BOX_WORLD);
    setFit((prev) => (prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next));
  }, [note.text]);

  // ------------------------------------------------------- select and drag
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    let press: Press | null = null;
    let isDragging = false;
    let pending: { dx: number; dy: number } | null = null;
    let frame: number | null = null;

    const applyPendingMove = (): void => {
      frame = null;
      if (!press || !pending) return;
      const { note: current, zoom: z } = live.current;
      const scale = z > 0 ? z : 1;
      // Screen delta / zoom keeps the grabbed point under the pointer at any zoom.
      const applied = moveObject(
        doc,
        current.id,
        press.originX + pending.dx / scale,
        press.originY + pending.dy / scale,
      );
      pending = null;
      if (!applied) stopDragging(); // note deleted mid-drag: end silently
    };

    const scheduleMove = (): void => {
      if (frame != null) return;
      frame = requestAnimationFrame(applyPendingMove);
    };

    const stopDragging = (): void => {
      if (frame != null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      pending = null;
      press = null;
      if (isDragging) {
        isDragging = false;
        setDragging(false);
      }
    };

    const inside = (target: EventTarget | null, selector: string): boolean =>
      target instanceof Element && target.closest(selector) !== null;

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      // Never steal clicks from the editor or the note's own toolbar.
      if (inside(event.target, '.sticky-note-input')) return;
      if (inside(event.target, '.note-toolbar')) return;
      // The board must not start a pan (sticky.no_pan).
      event.stopPropagation();
      // Track the pointer on the window, not on the note: the pointer can leave
      // the note, and bringing the note to front re-parents its element (which
      // would drop a pointer capture).
      startTracking();
      const { note: current } = live.current;
      press = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: current.x,
        originY: current.y,
      };
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!press || press.pointerId !== event.pointerId) return;
      const dx = event.clientX - press.startX;
      const dy = event.clientY - press.startY;
      if (!isDragging) {
        // A short press without movement stays a selection, never a move.
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        isDragging = true;
        setDragging(true);
        bringToFront(doc, live.current.note.id); // once per drag: draw above overlaps
      }
      pending = { dx, dy };
      scheduleMove();
    };

    const finish = (event: PointerEvent, flushPending: boolean): void => {
      stopTracking();
      if (!press || press.pointerId !== event.pointerId) return;
      const wasDragging = isDragging;
      if (frame != null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      // A released drag lands on the last pointer position; a cancelled drag
      // keeps the last position that was actually applied.
      if (flushPending && pending) applyPendingMove();
      else pending = null;
      isDragging = false;
      press = null;
      if (wasDragging) setDragging(false);
      live.current.onSelect(live.current.note.id);
    };

    const onPointerUp = (event: PointerEvent): void => finish(event, true);
    const onCancel = (event: PointerEvent): void => finish(event, false);

    const onDoubleClick = (event: MouseEvent): void => {
      // Never create a second note under an existing one (sticky.edit_start).
      event.stopPropagation();
      event.preventDefault();
      live.current.onStartEdit(live.current.note.id);
    };

    // While a press is active the pointer is tracked on the window.
    const startTracking = (): void => {
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onCancel);
    };
    const stopTracking = (): void => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      stopTracking();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, [doc]);

  const color = STICKY_COLORS[note.color];
  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      ref={rootRef}
      className="sticky-note"
      data-note-root=""
      data-note-id={note.id}
      data-testid="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-color={note.color}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: color,
      }}
    >
      <div className={`sticky-text${fit.overflow ? ' sticky-text-overflow' : ''}`} data-testid="sticky-text">
        <div
          ref={textRef}
          className="sticky-text-inner"
          data-testid="sticky-text-inner"
          style={{ fontSize: `${fit.fontPx}px` }}
        >
          {note.text}
        </div>
        {fit.overflow ? (
          <div
            className="sticky-text-fade"
            data-testid="sticky-text-fade"
            aria-hidden="true"
            style={{ background: `linear-gradient(to bottom, ${color}00, ${color})` }}
          />
        ) : null}
      </div>

      {editing && ytext ? (
        <StickyTextEditor
          key={note.id}
          ytext={ytext}
          fontPx={fit.fontPx}
          onEnd={(next) => onEndEdit(next)}
        />
      ) : null}

      {showToolbar ? (
        <div
          className="note-toolbar-anchor"
          style={{
            left: STICKY_SIZE_WORLD / 2,
            top: 0,
            transform: `scale(${1 / (zoom > 0 ? zoom : 1)})`,
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(next: StickyColor) => setStickyColor(doc, note.id, next)}
            onDelete={() => deleteObject(doc, note.id)}
          />
        </div>
      ) : null}
    </div>
  );
}
