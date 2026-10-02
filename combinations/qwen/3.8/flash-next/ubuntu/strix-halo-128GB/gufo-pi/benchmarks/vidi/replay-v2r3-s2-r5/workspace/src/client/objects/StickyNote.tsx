import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  setStickyColor,
  moveObject,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import {
  NOTE_FONT_STACK,
  NOTE_LINE_HEIGHT,
  NOTE_PADDING,
  NOTE_TEXT_COLOR,
  StickyTextEditor,
} from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

const SELECTION_OUTLINE = '2px solid #1976d2';

/**
 * One sticky note (sticky.interaction).
 * Unselected -> Pressed -> (Selected | Dragging) -> Editing, per the design's
 * state diagram. Selection and editing live in the parent; dragging is local.
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
  const elRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<Press | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // Keep the latest zoom without re-binding the pointer handlers.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const stopDrag = useCallback((applyPending: boolean) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (applyPending && pending) moveObject(doc, note.id, pending.x, pending.y);
    pressRef.current = null;
    draggingRef.current = false;
    setDragging(false);
    setPressing(false);
  }, [doc, note.id]);

  // A note removed from the document (stale id) must not leave work behind.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      pendingRef.current = null;
      pressRef.current = null;
    },
    [],
  );

  // Auto-fit: measure the text in board units (zoom scales it uniformly).
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const result = fitFontSize(el, STICKY_SIZE_WORLD - NOTE_PADDING * 2);
    setFit((prev) =>
      prev.fontPx === result.fontPx && prev.overflow === result.overflow ? prev : result,
    );
  }, [note.text]);

  const scheduleMove = useCallback(
    (x: number, y: number) => {
      pendingRef.current = { x, y };
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (!pending) return;
        // A stale id returns false and simply ends the drag.
        moveObject(doc, note.id, pending.x, pending.y);
      });
    },
    [doc, note.id],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Dragging a note must never pan the board (sticky.no_pan).
      e.stopPropagation();
      if (editing) return; // the textarea owns pointer interaction while editing

      pressRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: note.x,
        originY: note.y,
      };
      draggingRef.current = false;
      setDragging(false);
      setPressing(true);
      onSelect(note.id);
      const el = elRef.current;
      if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
    },
    [editing, note.id, note.x, note.y, onSelect],
  );

  // The drag is tracked on window, not with pointer capture: raising the note
  // to the top re-orders its DOM node, which would release the capture, and a
  // release outside the note (or outside the window) still has to end the drag.
  useLayoutEffect(() => {
    if (!pressing) return;

    const onMove = (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press || e.pointerId !== press.pointerId) return;

      const dx = e.clientX - press.startX;
      const dy = e.clientY - press.startY;

      if (!draggingRef.current) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        // Past the threshold: this is a drag, not a click.
        draggingRef.current = true;
        setDragging(true);
        bringToFront(doc, note.id);
      }

      const z = zoomRef.current || 1;
      // Screen delta -> world delta keeps the grabbed point under the pointer.
      scheduleMove(press.originX + dx / z, press.originY + dy / z);
    };

    const onUp = (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press || e.pointerId !== press.pointerId) return;
      stopDrag(true);
      onSelect(note.id);
    };

    // Interrupted drag (pointercancel, window blur): keep the shown position.
    const onInterrupt = (e?: Event) => {
      const press = pressRef.current;
      if (!press) return;
      const pointerId = (e as PointerEvent | undefined)?.pointerId;
      if (typeof pointerId === 'number' && pointerId !== press.pointerId) return;
      stopDrag(false);
      onSelect(note.id);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onInterrupt);
    window.addEventListener('blur', onInterrupt);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onInterrupt);
      window.removeEventListener('blur', onInterrupt);
    };
  }, [pressing, doc, note.id, onSelect, scheduleMove, stopDrag]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // A double-click on a note edits it; it must not create another note.
      e.stopPropagation();
      onStartEdit(note.id);
    },
    [note.id, onStartEdit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (editing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onStartEdit(note.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        deleteObject(doc, note.id);
      }
    },
    [doc, editing, note.id, onStartEdit],
  );

  const handleFocus = useCallback(() => {
    if (!editing) onSelect(note.id);
  }, [editing, note.id, onSelect]);

  // Clicking outside the note while editing ends editing (sticky.edit_end).
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: Event) => {
      const el = elRef.current;
      const target = e.target as Node | null;
      if (el && target && el.contains(target)) return;
      onEndEdit('unselected');
    };
    // Capture phase: note and toolbar handlers stop propagation on purpose.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, onEndEdit]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const showToolbar = selected && !dragging && !editing;

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Sticky note"
      aria-selected={selected}
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-color={note.color}
      data-x={note.x}
      data-y={note.y}
      data-z={note.z}
      tabIndex={0}
      className={`vidi6-sticky-note${fit.overflow ? ' vidi6-sticky-note--overflow' : ''}`}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        boxSizing: 'border-box',
        color: NOTE_TEXT_COLOR,
        fontFamily: NOTE_FONT_STACK,
        outline: selected ? SELECTION_OUTLINE : 'none',
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: editing ? 'text' : 'none',
        WebkitUserSelect: editing ? 'text' : 'none',
        touchAction: 'none',
        // The world layer is pointer-events: none so it can never swallow board
        // panning; notes switch interaction back on for themselves.
        pointerEvents: 'auto',
        zIndex: note.z,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
    >
      {/* The painted surface clips its text; the root does not, so the
          selection toolbar can float above the note. */}
      <div
        data-testid="sticky-note-surface"
        aria-hidden="false"
        style={{
          position: 'absolute',
          inset: 0,
          boxSizing: 'border-box',
          backgroundColor: STICKY_COLORS[note.color],
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}
      >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          data-testid="sticky-note-text"
          className="vidi6-sticky-note-text"
          style={{
            position: 'absolute',
            inset: 0,
            padding: NOTE_PADDING,
            boxSizing: 'border-box',
            textAlign: 'center',
            fontSize: fit.fontPx,
            lineHeight: NOTE_LINE_HEIGHT,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
          }}
        >
          {note.text}
        </div>
      )}

      {/* Bottom fade shown when text no longer fits at the minimum size. */}
      {fit.overflow && (
        <div
          data-testid="sticky-note-fade"
          className="vidi6-sticky-note-fade"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 32,
            pointerEvents: 'none',
            background: `linear-gradient(to bottom, rgba(255,255,255,0), ${STICKY_COLORS[note.color]})`,
          }}
        />
      )}
      </div>

      {/* Hidden measuring node: same width and wrapping as the text layer. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        data-testid="sticky-note-measure"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: STICKY_SIZE_WORLD - NOTE_PADDING * 2,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: NOTE_FONT_STACK,
          lineHeight: NOTE_LINE_HEIGHT,
        }}
      >
        {note.text}
      </div>

      {showToolbar && (
        <div
          data-testid="note-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            marginBottom: 6 / zoom,
            // Counter-scale so the toolbar keeps a constant size on screen.
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'bottom left',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color) => {
              setStickyColor(doc, note.id, color);
            }}
            onDelete={() => {
              deleteObject(doc, note.id);
            }}
          />
        </div>
      )}
    </div>
  );
}
