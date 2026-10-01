import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** The board zoom: screen pixels are divided by it to get world units. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onDeleted?(id: string): void;
}

/** Inner padding around the text, in world units. */
export const NOTE_PADDING_WORLD = 12;

/**
 * A sticky note, drawn inside the zoomed world layer at its world coordinates.
 *
 * - Press selects; press-and-move (past `DRAG_THRESHOLD_PX` screen pixels)
 *   drags, raising the note above the others for the whole drag.
 * - Double-click edits, as does the caller via Enter on a selected note.
 * - The text auto-fits its box and clips with a fade when it cannot shrink any
 *   further.
 *
 * Drag listeners live on the window, not on the note: raising the note at drag
 * start re-orders the DOM, and a node that is re-inserted stops receiving the
 * pointer events it had captured.
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
  onDeleted,
}: StickyNoteProps) {
  const textRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [fontFit, setFontFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);

  // Press bookkeeping in refs: pointermove fires far more often than React
  // should re-render.
  const pressRef = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);
  const stateRef = useRef<'idle' | 'pressed' | 'dragging'>('idle');
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const ytext = useMemo(() => getStickyText(doc, note.id), [doc, note.id]);

  // Auto-fit: the largest size at which the text still fits, and whether it
  // had to stop at the floor (which then clips with a fade).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el);
    setFontFit((prev) =>
      prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next,
    );
  }, [note.text, editing, note.id]);

  const endInteraction = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    pendingRef.current = null;
    pressRef.current = null;
    stateRef.current = 'idle';
    setListening(false);
    setDragging(false);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return; // the editor owns its own pointer input
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // A note owns its pointer: the board must not pan under it.
    event.stopPropagation();
    onSelect(note.id);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Environments without pointer capture still drag through window events.
    }
    pressRef.current = {
      sx: event.clientX,
      sy: event.clientY,
      x: note.x,
      y: note.y,
    };
    stateRef.current = 'pressed';
    setListening(true);
  };

  useEffect(() => {
    if (!listening) return;

    const applyPending = () => {
      rafRef.current = 0;
      const target = pendingRef.current;
      if (!target) return;
      pendingRef.current = null;
      // A note deleted mid-drag ends the drag silently: moveObject refuses,
      // and nothing recreates it.
      if (!moveObject(doc, note.id, target.x, target.y)) endInteraction();
    };

    const onMove = (event: PointerEvent) => {
      const press = pressRef.current;
      if (!press) return;
      if (stateRef.current !== 'dragging') {
        if (
          Math.abs(event.clientX - press.sx) < DRAG_THRESHOLD_PX &&
          Math.abs(event.clientY - press.sy) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        stateRef.current = 'dragging';
        setDragging(true);
        bringToFront(doc, note.id);
      }
      const scale = zoomRef.current || 1;
      pendingRef.current = {
        x: press.x + (event.clientX - press.sx) / scale,
        y: press.y + (event.clientY - press.sy) / scale,
      };
      // Exactly one model write per animation frame, always to the latest point.
      if (!rafRef.current) rafRef.current = requestAnimationFrame(applyPending);
    };

    const onUp = () => {
      if (stateRef.current === 'dragging') {
        // Flush: the final position must not be left waiting for a frame.
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        const target = pendingRef.current;
        pendingRef.current = null;
        if (target) moveObject(doc, note.id, target.x, target.y);
      }
      endInteraction();
    };

    const onCancel = () => {
      // A cancelled drag keeps the last applied position.
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      pendingRef.current = null;
      endInteraction();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [listening, doc, note.id, endInteraction]);

  // A note deleted by someone else cannot be edited or dragged any more.
  useEffect(() => {
    if (ytext) return;
    endInteraction();
    if (editing) onEndEdit('unselected');
    if (selected) onDeleted?.(note.id);
    // Only when the note disappears: these run on every render otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext === null]);

  // Editing ends on a pointerdown outside this note (a click on the board, on
  // another note, on the left toolbar). Capture phase, because notes and
  // toolbars stop propagation and a bubble listener would never run.
  useEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (event.target instanceof Node && el.contains(event.target)) return;
      onEndEdit('unselected');
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  }, [editing, onEndEdit]);

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Never falls through to the viewport's create gesture.
    event.stopPropagation();
    onStartEdit(note.id);
  };

  return (
    <div
      ref={rootRef}
      className="board-object sticky-note"
      role="group"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-world-x={note.x}
      data-world-y={note.y}
      data-z={note.z}
      data-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      aria-label="Sticky note"
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: `var(--note-${note.color})`,
      }}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={textRef}
        className={`sticky-note-text${fontFit.overflow ? ' fade-bottom' : ''}`}
        data-testid="sticky-note-text"
        data-overflow={fontFit.overflow ? 'true' : 'false'}
        aria-hidden={editing ? true : undefined}
        style={{
          padding: `${NOTE_PADDING_WORLD}px`,
          fontSize: `${fontFit.fontPx}px`,
          opacity: editing ? 0 : 1,
        }}
      >
        {note.text}
      </div>
      {editing && ytext ? (
        <StickyTextEditor
          key={note.id}
          ytext={ytext}
          fontPx={fontFit.fontPx}
          boxPx={STICKY_SIZE_WORLD - NOTE_PADDING_WORLD * 2}
          onEnd={onEndEdit}
        />
      ) : null}
      {/* Hidden while dragging or editing: it would sit under the pointer. */}
      {selected && !dragging && !editing ? (
        <div
          className="note-toolbar-anchor"
          data-testid="note-toolbar-anchor"
          style={{ transform: `scale(${zoom === 0 ? 1 : 1 / zoom})` }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color) => {
              setStickyColor(doc, note.id, color);
            }}
            onDelete={() => {
              deleteObject(doc, note.id);
              onDeleted?.(note.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
