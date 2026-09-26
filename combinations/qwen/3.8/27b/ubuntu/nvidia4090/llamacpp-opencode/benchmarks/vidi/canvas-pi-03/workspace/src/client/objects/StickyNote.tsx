import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from '@/shared/config';

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '@/shared/board-model';
import { NOTE_PADDING, NOTE_TEXT_BOX, fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Current camera zoom (screen px per world unit). */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Story 4: false while the board failed to load. Selection stays possible
   * but drag, edit-start and the note toolbar (colour/delete) are blocked.
   */
  editable: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

const SELECTION_OUTLINE = '#1A73E8';

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  dragging: boolean;
  pendingWorld: { x: number; y: number } | null;
  rafId: number | null;
}

/**
 * A sticky note on the board (story 2). Renders the note in the world layer
 * at world (x, y); handles select, drag-to-move, edit start/end, colour and
 * delete. Selection/toolbar state is local; all mutations go through the
 * board model.
 *
 * Interaction states (per note, never stored in the doc):
 *   Unselected -> Pressed (pointerdown) -> Selected (up within threshold)
 *   Pressed -> Dragging (move >= DRAG_THRESHOLD_PX) -> Selected (up/cancel)
 *   Selected -> Editing (dblclick or Enter) -> Selected (Escape)
 *   Editing -> Unselected (click outside)
 */
export function StickyNote(props: StickyNoteProps): ReactElement {
  const { note, doc, zoom, selected, editing, editable, onSelect, onStartEdit, onEndEdit } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const [dragging, setDragging] = useState(false);
  const [font, setFont] = useState(() => ({ fontPx: STICKY_FONT_MAX_PX, overflow: false }));

  const colorName: StickyColor = Object.prototype.hasOwnProperty.call(STICKY_COLORS, note.color)
    ? (note.color as StickyColor)
    : DEFAULT_STICKY_COLOR;
  const background = STICKY_COLORS[colorName];

  // Font fit: binary search on the hidden mirror (zoom scales world units
  // uniformly, so no re-fit on zoom). The fit forces a reflow, and a reflow
  // is O(boards notes) — so fitting every note on mount is O(n²) and makes a
  // large board's first paint stall for seconds (story 4, persist.large_board).
  // So the FIRST fit (on mount) is deferred until the note is (near) in the
  // viewport, which bounds an initial load to the visible slice. A re-fit on
  // text change is a single note (O(1)) and stays synchronous, matching the
  // pre-change behaviour editors depend on. Non-browser envs (jsdom) fit now.
  const prevTextRef = useRef(note.text);
  useEffect(() => {
    const mirror = mirrorRef.current;
    const root = rootRef.current;
    if (!mirror || !root) return;
    const textChanged = prevTextRef.current !== note.text;
    prevTextRef.current = note.text;
    const doFit = () => setFont(fitFontSize(mirror, NOTE_TEXT_BOX));
    if (textChanged || typeof IntersectionObserver === 'undefined') {
      doFit();
      return;
    }
    // First fit: defer until the note is (near) on screen.
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        for (const e of entries) {
          if (e.isIntersecting) {
            doFit();
            io.disconnect();
            return;
          }
        }
      },
      // A little before the note is on screen so scrolling never flashes an
      // un-fitted size.
      { rootMargin: '256px 0px' },
    );
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [note.text]);

  // If the note is deleted mid-drag (stale id), cancel any pending frame.
  useEffect(() => {
    return () => {
      const drag = dragRef.current;
      if (drag?.rafId !== null && drag?.rafId !== undefined) {
        cancelAnimationFrame(drag.rafId);
      }
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // The board must not pan when a drag starts on a note (sticky.no_pan).
      e.stopPropagation();
      if (editing) return; // The textarea owns the pointer while editing.
      onSelect(note.id);
      if (!editable) return; // story 4: select-only; dragging is blocked
      const el = rootRef.current;
      if (!el) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorldX: note.x,
        startWorldY: note.y,
        dragging: false,
        pendingWorld: null,
        rafId: null,
      };
    },
    [editing, editable, note.id, note.x, note.y, onSelect],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (!drag.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.dragging = true;
        setDragging(true);
        // The note under the pointer comes to the front (once, at drag start).
        bringToFront(doc, note.id);
      }
      const z = zoomRef.current;
      drag.pendingWorld = { x: drag.startWorldX + dx / z, y: drag.startWorldY + dy / z };
      if (drag.rafId === null) {
        drag.rafId = requestAnimationFrame(() => {
          const state = dragRef.current;
          if (!state) return;
          state.rafId = null;
          const pending = state.pendingWorld;
          if (!pending) return;
          state.pendingWorld = null;
          // moveObject returns false when the note was deleted meanwhile:
          // the drag ends silently (TC-37).
          if (!moveObject(doc, note.id, pending.x, pending.y)) {
            dragRef.current = null;
            setDragging(false);
          }
        });
      }
    },
    [doc, note.id],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (drag.rafId !== null) {
        cancelAnimationFrame(drag.rafId);
        drag.rafId = null;
      }
      // Flush the last pending position so the note ends exactly where it was
      // last shown (drag interrupted: the note stays where it was last shown).
      if (drag.pendingWorld !== null) {
        const pending = drag.pendingWorld;
        drag.pendingWorld = null;
        moveObject(doc, note.id, pending.x, pending.y);
      }
      dragRef.current = null;
      setDragging(false);
      try {
        rootRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      onSelect(note.id); // Pressed/Dragging -> Selected
    },
    [doc, note.id, onSelect],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // The viewport must not create a new note when a note is double-clicked.
      e.stopPropagation();
      if (!editing && editable) onStartEdit(note.id);
    },
    [editing, editable, note.id, onStartEdit],
  );

  const ytext = getStickyText(doc, note.id);

  return (
    <div
      ref={rootRef}
      data-testid="sticky-note"
      data-id={note.id}
      data-selected={selected ? true : undefined}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={handleDoubleClick}
      onFocus={() => {
        if (!editing) onSelect(note.id);
      }}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        // Stacking via z-index (not DOM order) so bringToFront re-renders
        // without moving the node, which would drop pointer capture mid-drag.
        zIndex: note.z,
        background,
        borderRadius: 6,
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.18)',
        outline: selected ? `2px solid ${SELECTION_OUTLINE}` : 'none',
        outlineOffset: 2,
        cursor: !editable ? 'default' : dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        fontFamily: 'Arial, Helvetica, sans-serif',
        userSelect: 'none',
      }}
    >
      {/* Hidden mirror used for font measurement (same width/font as display text). */}
      <div
        ref={mirrorRef}
        data-testid="sticky-note-mirror"
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: NOTE_PADDING,
          left: NOTE_PADDING,
          width: NOTE_TEXT_BOX,
          height: NOTE_TEXT_BOX,
          visibility: 'hidden',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.25,
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>

      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={font.fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          data-testid="sticky-note-text"
          className={font.overflow ? 'sticky-note-text sticky-note-text--fade' : 'sticky-note-text'}
          style={{
            position: 'absolute',
            top: NOTE_PADDING,
            left: NOTE_PADDING,
            right: NOTE_PADDING,
            bottom: NOTE_PADDING,
            display: 'flex',
            justifyContent: 'center',
            alignItems: font.overflow ? 'flex-start' : 'center',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: '100%',
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: `${font.fontPx}px`,
              lineHeight: 1.25,
              color: 'rgba(0, 0, 0, 0.8)',
            }}
          >
            {note.text}
          </div>
        </div>
      )}

      {/* Bottom fade when the text no longer fits at the minimum size. */}
      {font.overflow && !editing && (
        <div
          data-testid="sticky-note-fade"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 24,
            borderRadius: '0 0 6px 6px',
            background: `linear-gradient(to bottom, ${hexToRgba(background, 0)}, ${background})`,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Note toolbar: screen space above the note (unscaled by zoom),
          only for the selected note, hidden while dragging or editing. */}
      {selected && !editing && !dragging && editable && (
        <div
          style={{
            position: 'absolute',
            left: STICKY_SIZE_WORLD / 2,
            top: 0,
            width: 0,
            height: 0,
            transform: `scale(${1 / zoom})`,
            transformOrigin: '0 0',
            zIndex: 9999,
          }}
        >
          <div style={{ position: 'absolute', transform: 'translate(-50%, calc(-100% - 8px))' }}>
            <NoteToolbar
              color={colorName}
              onColor={(c) => {
                setStickyColor(doc, note.id, c);
              }}
              onDelete={() => {
                deleteObject(doc, note.id);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
