import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import {
  bringToFront,
  deleteObject,
  getObjectsMap,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import type { StickyColor } from '../../shared/config';
import { fitFontSize, NOTE_TEXT_INSET } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom; notes scale with the board, the note toolbar does not. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** When false (board failed to load), drag/edit/colour/delete are no-ops. */
  editable?: boolean;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  latestClientX: number;
  latestClientY: number;
  startWorldX: number;
  startWorldY: number;
  zoom: number;
  raf: number | null;
  moved: boolean;
}

/** Current stored position, or null when the note no longer exists. */
function stickyPosition(doc: Y.Doc, id: string): { x: number; y: number } | null {
  const m = getObjectsMap(doc).get(id);
  if (!m || m.get('type') !== 'sticky') return null;
  return { x: m.get('x') as number, y: m.get('y') as number };
}

/**
 * One sticky note, drawn in the world layer at its (x, y). Selecting, dragging,
 * editing and recolouring all happen here; every document change goes through
 * board-model.
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
  editable = true,
}: StickyNoteProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Text auto-fit: the largest size that fits, recomputed when the text changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // Without a layout engine (jsdom) clientHeight is 0, and the size stays at
    // the maximum — all a layout-free test can assert.
    const box = el.clientHeight > 0 ? el.clientHeight : Number.POSITIVE_INFINITY;
    const result = fitFontSize(el, box);
    setFontPx((prev) => (prev === result.fontPx ? prev : result.fontPx));
    setOverflow((prev) => (prev === result.overflow ? prev : result.overflow));
  }, [note.text, editing]);

  const stopDrag = (selectAfter: boolean) => {
    const drag = dragRef.current;
    if (drag?.raf != null) cancelAnimationFrame(drag.raf);
    dragRef.current = null;
    detachWindow();
    // Always cleared; React skips the re-render when it was already false.
    setDragging(false);
    if (selectAfter) onSelect(note.id);
  };

  // Applied once per animation frame: coalesces a burst of pointermoves into a
  // single Yjs update.
  const applyDragFrame = () => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.raf = null;
    const dx = (drag.latestClientX - drag.startClientX) / drag.zoom;
    const dy = (drag.latestClientY - drag.startClientY) / drag.zoom;
    const x = drag.startWorldX + dx;
    const y = drag.startWorldY + dy;
    const current = stickyPosition(doc, note.id);
    // A missing note means it was deleted elsewhere: end the drag quietly.
    if (!current) {
      stopDrag(false);
      return;
    }
    if (current.x !== x || current.y !== y) moveObject(doc, note.id, x, y);
  };

  // The drag listeners live on the window, not on the note: raising the note
  // re-orders the world layer's children, which would drop a pointer capture
  // taken on the element.
  const impl = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
  } | null>(null);

  impl.current = {
    move: (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;

      if (!drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        setDragging(true);
        bringToFront(doc, note.id);
      }

      drag.latestClientX = e.clientX;
      drag.latestClientY = e.clientY;
      if (drag.raf === null) drag.raf = requestAnimationFrame(applyDragFrame);
    },
    up: (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.moved) {
        // Land exactly under the pointer rather than one frame behind it.
        drag.latestClientX = e.clientX;
        drag.latestClientY = e.clientY;
        applyDragFrame();
      }
      stopDrag(true);
    },
    // A cancelled pointer keeps the last position that was applied.
    cancel: () => stopDrag(true),
  };

  // Stable function identities so the listeners can be removed again.
  const winMoveRef = useRef((e: PointerEvent) => impl.current?.move(e));
  const winUpRef = useRef((e: PointerEvent) => impl.current?.up(e));
  const winCancelRef = useRef((e: PointerEvent) => impl.current?.cancel(e));

  const attachWindow = () => {
    window.addEventListener('pointermove', winMoveRef.current);
    window.addEventListener('pointerup', winUpRef.current);
    window.addEventListener('pointercancel', winCancelRef.current);
  };

  function detachWindow() {
    window.removeEventListener('pointermove', winMoveRef.current);
    window.removeEventListener('pointerup', winUpRef.current);
    window.removeEventListener('pointercancel', winCancelRef.current);
  }

  useEffect(() => detachWindow, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // The board must never pan because a press started on a note.
      e.stopPropagation();
      // While editing, a press inside the note belongs to the text caret.
      if (editing) return;
      // A read-only board starts no drag.
      if (!editable) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        latestClientX: e.clientX,
        latestClientY: e.clientY,
        startWorldX: note.x,
        startWorldY: note.y,
        zoom: zoomRef.current || 1,
        raf: null,
        moved: false,
      };
      attachWindow();
    },
    [note.x, note.y, editing, editable],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Editing this note, never creating a new one behind it.
      e.stopPropagation();
      if (!editable) return;
      onStartEdit(note.id);
    },
    [note.id, onStartEdit, editable],
  );

  // Focus returns to the note when editing ends, so Delete still works.
  useEffect(() => {
    if (selected && !editing) rootRef.current?.focus({ preventScroll: true });
  }, [selected, editing]);

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!editable) return;
      setStickyColor(doc, note.id, color);
    },
    [doc, note.id, editable],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    deleteObject(doc, note.id);
    onEndEdit('unselected');
  }, [doc, note.id, onEndEdit, editable]);

  const background = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;
  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={rootRef}
      data-note-id={note.id}
      data-testid="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: background,
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        outline: selected ? '2px solid #1976D2' : 'none',
        boxSizing: 'border-box',
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        ref={textRef}
        data-testid="sticky-note-text"
        className={
          overflow ? 'sticky-note__text sticky-note__text--overflow' : 'sticky-note__text'
        }
        style={{
          position: 'absolute',
          inset: NOTE_TEXT_INSET,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          textAlign: 'center',
          color: '#1f1f1f',
          fontFamily: 'inherit',
          fontWeight: 500,
          lineHeight: 1.25,
          fontSize: fontPx,
          opacity: editing ? 0 : 1,
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>
      {overflow && !editing && (
        <div
          className="sticky-note__fade"
          data-testid="sticky-note-fade"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: NOTE_TEXT_INSET,
            right: NOTE_TEXT_INSET,
            bottom: NOTE_TEXT_INSET,
            height: Math.max(12, fontPx * 1.25),
            pointerEvents: 'none',
            background: `linear-gradient(to bottom, rgba(255,255,255,0) 0%, ${background} 85%)`,
          }}
        />
      )}
      {editing && ytext && (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      )}
      {selected && !editing && !dragging && (
        <div
          data-testid="note-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            // Counteracts the world scale so the toolbar keeps a screen-space size.
            transform: `scale(${1 / (zoom || 1)})`,
            transformOrigin: 'bottom left',
            paddingBottom: 8,
          }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
