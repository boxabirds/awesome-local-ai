import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DRAG_THRESHOLD_PX,
} from '../../shared/config';
import {
  bringToFront,
  moveObject,
  deleteObject,
  setStickyColor,
  getStickyText,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

const PADDING_PX = 16;
const TEXT_BOX = STICKY_SIZE_WORLD - 2 * PADDING_PX;
const SELECTION_OUTLINE = '2px solid #1a73e8';

// jsdom-safe rAF (vitest's jsdom provides it, but be robust).
function raf(cb: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(() => cb(0), 16) as unknown as number;
}

function cancelRaf(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}

type DragState = 'idle' | 'pressed' | 'dragging';

interface DragInfo {
  state: DragState;
  pointerId: number;
  startX: number;
  startY: number;
  worldX: number;
  worldY: number;
}

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/**
 * A sticky note on the board: render, select, drag, edit.
 *
 * Per-note interaction state (never stored in the doc):
 *   Unselected → Pressed (pointerdown) → Selected (pointerup within
 *   DRAG_THRESHOLD_PX) or Dragging (beyond it) → Selected (pointerup /
 *   pointercancel at the last applied position).
 *   Double-click (or Enter, handled by App) → Editing.
 *
 * pointerdown stops propagation so the viewport never pans while a note is
 * dragged. If the note is deleted mid-interaction the interaction ends
 * silently (stale id → model calls return false, component unmounts).
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
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(24);
  const [overflow, setOverflow] = useState(false);
  const [dragging, setDragging] = useState(false);

  const dragRef = useRef<DragInfo | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);

  // Auto-fit font: largest size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
  // at which the text fits the note box. Runs on mount and text change only
  // (zoom scales everything uniformly).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const { fontPx: px, overflow: of } = fitFontSize(el, TEXT_BOX);
    setFontPx(px);
    setOverflow(of);
  }, [note.text]);

  // Cancel any pending move frame on unmount (note deleted mid-drag).
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelRaf(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const flushPending = () => {
    if (rafRef.current !== null) {
      cancelRaf(rafRef.current);
      rafRef.current = null;
    }
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) moveObject(doc, note.id, p.x, p.y);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // the board must not pan
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom does not support pointer capture
    }
    dragRef.current = {
      state: 'pressed',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      worldX: note.x,
      worldY: note.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (d.state === 'pressed') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a press
      d.state = 'dragging';
      setDragging(true);
      bringToFront(doc, note.id); // once, so it draws above everything
    }

    // World delta = screen delta / zoom, so the grabbed point stays under
    // the pointer at any zoom.
    const x = d.worldX + dx / zoom;
    const y = d.worldY + dy / zoom;
    pendingRef.current = { x, y };
    if (rafRef.current === null) {
      rafRef.current = raf(() => {
        rafRef.current = null;
        const p = pendingRef.current;
        pendingRef.current = null;
        if (p) moveObject(doc, note.id, p.x, p.y);
      });
    }
  };

  const endInteraction = (e: React.PointerEvent<HTMLDivElement> | null) => {
    const d = dragRef.current;
    if (!d || (e && e.pointerId !== d.pointerId)) return;
    if (e) e.stopPropagation();
    dragRef.current = null;
    setDragging(false);
    flushPending(); // keep the last shown position
    if (getStickyText(doc, note.id) !== undefined) {
      onSelect(note.id);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    endInteraction(e);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    endInteraction(e);
  };

  const handleLostPointerCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    // Pointer released outside the window / system interruption: the note
    // stays where it was last shown.
    endInteraction(e);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // do not create a new note on top
    onStartEdit(note.id);
  };

  const handleDelete = () => {
    if (deleteObject(doc, note.id)) {
      onSelect(null);
    }
  };

  const ytext = getStickyText(doc, note.id);
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      data-sticky-note
      data-testid="sticky-note"
      data-id={note.id}
      role="group"
      aria-label="Sticky note"
      data-selected={selected ? '' : undefined}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
      onFocus={() => onSelect(note.id)}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        // Stacking follows the model's z (DOM order is kept stable by App).
        zIndex: note.z,
        background: STICKY_COLORS[note.color],
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        borderRadius: 2,
        outline: selected ? SELECTION_OUTLINE : 'none',
        outlineOffset: 2,
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        // No overflow clipping here: the floating note toolbar extends
        // above the note's top edge and must remain clickable. The text
        // div clips its own content.
      }}
    >
      {/* Text display (also the measurement element while editing).
          The box is exactly TEXT_BOX × TEXT_BOX with no padding: the inset
          positioning provides the visual padding, and scrollHeight must
          represent the text alone for fitFontSize's "scrollHeight <= box". */}
      <div
        ref={textRef}
        data-testid="sticky-text"
        style={{
          position: 'absolute',
          top: PADDING_PX,
          left: PADDING_PX,
          width: TEXT_BOX,
          height: TEXT_BOX,
          fontFamily: 'inherit',
          fontSize: `${fontPx}px`,
          lineHeight: 1.2,
          color: 'rgba(0,0,0,0.85)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          visibility: editing ? 'hidden' : 'visible',
        }}
      >
        {note.text}
      </div>

      {overflow && !editing && (
        <div
          className="sticky-note-overflow"
          data-testid="sticky-fade"
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 48,
            pointerEvents: 'none',
            background: `linear-gradient(to bottom, transparent, ${STICKY_COLORS[note.color]})`,
          }}
        />
      )}

      {editing && ytext && (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      )}

      {showToolbar && (
        <div
          data-testid="note-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-end',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              transform: `scale(${1 / zoom})`,
              transformOrigin: 'bottom center',
              marginBottom: 8,
              pointerEvents: 'auto',
            }}
          >
            <NoteToolbar
              color={note.color}
              onColor={(c) => setStickyColor(doc, note.id, c)}
              onDelete={handleDelete}
            />
          </div>
        </div>
      )}
    </div>
  );
}
