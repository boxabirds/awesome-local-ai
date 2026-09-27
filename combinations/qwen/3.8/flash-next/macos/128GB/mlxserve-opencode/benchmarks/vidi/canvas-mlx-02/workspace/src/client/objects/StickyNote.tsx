// A sticky note on the board (story 2): renders, selects, drags to move and
// edits its text. Selection/editing are props (never stored in the doc); all
// mutations go through the board-model.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { getStickyText, moveObject, bringToFront, type StickySnapshot } from '../../shared/board-model.ts';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DRAG_THRESHOLD_PX,
} from '../../shared/config.ts';
import { fitFontSize } from './StickyText.ts';
import { StickyTextEditor, StickyCharCounter } from './StickyTextEditor.tsx';
import { NoteToolbar } from './NoteToolbar.tsx';
import type { EndMode } from '../board/useSelection.ts';

const PADDING = 12;
const CONTENT_W = STICKY_SIZE_WORLD - PADDING * 2;
const CONTENT_H = STICKY_SIZE_WORLD - PADDING * 2;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndMode): void;
  onColor(id: string, color: string): void;
  onDelete(id: string): void;
}

type DragState = 'none' | 'pressed' | 'dragging';

export function StickyNote(props: StickyNoteProps): React.JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit, onColor, onDelete } =
    props;

  const elRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  // Font auto-fit: run on mount and whenever the text changes (never on zoom —
  // the world font scales uniformly with the board).
  const [fit, setFit] = useState({ fontPx: 24, overflow: false });
  // Reactive copy of the drag state so the floating toolbar hides while dragging.
  const [dragging, setDragging] = useState(false);

  const measure = useCallback(() => {
    const el = measureRef.current;
    if (!el) return;
    el.textContent = note.text;
    const r = fitFontSize(el, CONTENT_H);
    setFit((prev) => (prev.fontPx === r.fontPx && prev.overflow === r.overflow ? prev : r));
  }, [note.text]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // Drag state kept in refs so pointer handlers read live values.
  const drag = useRef<{
    state: DragState;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWorldX: number;
    startWorldY: number;
    lastX: number;
    lastY: number;
    raf: number | null;
  }>({
    state: 'none',
    pointerId: 0,
    startClientX: 0,
    startClientY: 0,
    startWorldX: 0,
    startWorldY: 0,
    lastX: 0,
    lastY: 0,
    raf: null,
  });

  const flushMove = useCallback(() => {
    const d = drag.current;
    d.raf = null;
    const ok = moveObject(doc, note.id, d.lastX, d.lastY);
    if (!ok) {
      // Note vanished mid-drag: end interaction silently (TC-37).
      cancelDrag();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, note.id]);

  const scheduleMove = useCallback(() => {
    const d = drag.current;
    if (d.raf != null) return; // one moveObject per frame
    d.raf = requestAnimationFrame(flushMove);
  }, [flushMove]);

  const cancelDrag = useCallback(() => {
    const d = drag.current;
    if (d.raf != null) {
      cancelAnimationFrame(d.raf);
      d.raf = null;
    }
    d.state = 'none';
  }, []);

  // Clean up a pending rAF on unmount.
  useEffect(() => () => cancelDrag(), [cancelDrag]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // The board must never pan when a note is grabbed.
    e.stopPropagation();
    if (editing) return; // clicks inside the editor are handled there
    const d = drag.current;
    d.state = 'pressed';
    d.pointerId = e.pointerId;
    d.startClientX = e.clientX;
    d.startClientY = e.clientY;
    d.startWorldX = note.x;
    d.startWorldY = note.y;
    d.lastX = note.x;
    d.lastY = note.y;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* jsdom / unsupported */
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.state === 'none' || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    if (d.state === 'pressed') {
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a possible click
      // Crossing the threshold starts a real drag: select it now. Coming to the
      // front is deferred to pointerup so the DOM node is not reordered mid-drag
      // (reordering can drop pointer capture).
      onSelect(note.id);
      d.state = 'dragging';
      setDragging(true);
    }
    const wx = d.startWorldX + (e.clientX - d.startClientX) / zoom;
    const wy = d.startWorldY + (e.clientY - d.startClientY) / zoom;
    d.lastX = wx;
    d.lastY = wy;
    scheduleMove();
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.state === 'none' || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    if (d.raf != null) {
      // Apply the final position immediately rather than waiting for a frame.
      cancelAnimationFrame(d.raf);
      d.raf = null;
    }
    const wasDragging = d.state === 'dragging';
    d.state = 'none';
    if (wasDragging) {
      // Commit the last shown position and bring the note to the front now that
      // the pointer is released (no mid-drag DOM reorder to break capture).
      moveObject(doc, note.id, d.lastX, d.lastY);
      bringToFront(doc, note.id);
      setDragging(false);
    }
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    // A short press (or the end of a drag) leaves the note selected.
    onSelect(note.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (editing) return;
    onStartEdit(note.id);
  };

  const ytext = getStickyText(doc, note.id);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: note.x,
    top: note.y,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    background: STICKY_COLORS[note.color],
    boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
    borderRadius: 2,
    color: '#202020',
    fontFamily: 'system-ui, sans-serif',
    cursor: editing ? 'text' : 'grab',
    boxSizing: 'border-box',
    outline: selected ? '2px solid #2563eb' : 'none',
    outlineOffset: 0,
    touchAction: 'none',
    pointerEvents: 'auto',
  };

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Sticky note"
      data-testid={`sticky-${note.id}`}
      data-selected={selected}
      data-editing={editing}
      tabIndex={0}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={() => {
        // Pointer captured then lost (e.g. released outside): keep last position.
        cancelDrag();
        setDragging(false);
      }}
      onDoubleClick={onDoubleClick}
    >
      {/* Hidden measuring mirror: same metrics as the visible text, used to pick
          the largest fitting font size. Invisible and non-interactive. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        data-testid={`sticky-measure-${note.id}`}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: CONTENT_W,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          lineHeight: 1.25,
          fontFamily: 'system-ui, sans-serif',
        }}
      />

      {/* Displayed text (hidden while editing, where the editor shows the text). */}
      <div
        data-testid={`sticky-text-${note.id}`}
        className={`sticky-text${fit.overflow ? ' sticky-text-overflow' : ''}`}
        style={{
          position: 'absolute',
          inset: 0,
          padding: `${PADDING}px`,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          overflow: 'hidden',
          fontSize: `${fit.fontPx}px`,
          lineHeight: 1.25,
          visibility: editing ? 'hidden' : 'visible',
          // The note frame owns pointer interaction; the rendered text is display-only.
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>

      {editing && ytext && <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />}
      {editing && <StickyCharCounter length={note.text.length} />}

      {/* Colour / delete toolbar above the note, inverse-scaled so it stays a
          constant screen size; hidden while dragging or editing. */}
      {selected && !editing && !dragging && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            marginBottom: 6,
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'bottom left',
            pointerEvents: 'auto',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c) => onColor(note.id, c)}
            onDelete={() => onDelete(note.id)}
          />
        </div>
      )}
    </div>
  );
}
