import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  moveObject,
  bringToFront,
  getStickyText,
  type StickySnapshot,
} from '../../shared/board-model.ts';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  DRAG_THRESHOLD_PX,
} from '../../shared/config.ts';
import { fitFontSize } from './StickyText.ts';
import { StickyTextEditor } from './StickyTextEditor.tsx';

const PADDING = 12;
const INNER = STICKY_SIZE_WORLD - PADDING * 2;
const LINE_HEIGHT = 1.25;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Reported when a drag starts/ends so the shell can hide the note toolbar
   *  while dragging (and, with it, the toolbar would re-sort the DOM). */
  onDragChange?(id: string, dragging: boolean): void;
  /** False while the board may not be edited (story 4: it failed to load).
   *  Selection still works; dragging and editing do not. */
  canEdit?: boolean;
}

/**
 * A sticky note: an absolutely positioned square in the world layer at (x, y) of
 * size STICKY_SIZE_WORLD, filled with its colour, text centred and auto-fit.
 * Implements the per-note interaction state machine (Unselected → Pressed →
 * Selected → Dragging / Editing).
 *
 * Dragging uses window-level pointermove/up/cancel listeners rather than pointer
 * capture, because raising a note to the front re-orders it in the DOM, which
 * would drop pointer capture and abort the drag. Every mutation goes through
 * board-model; selection/editing live in the shell.
 */
export function StickyNote(props: StickyNoteProps) {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit, onDragChange } =
    props;
  const canEdit = props.canEdit ?? true;

  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  // Recompute the auto-fit font size on mount and whenever the text changes
  // (never on zoom: the font is in world units, so zoom scales it uniformly).
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    setFit(fitFontSize(el, INNER));
  }, [note.text]);

  // --- interaction refs (never React state; the drag never re-renders itself) ---
  const phaseRef = useRef<'idle' | 'pressed' | 'dragging'>('idle');
  const startClientRef = useRef({ x: 0, y: 0 });
  const startWorldRef = useRef({ x: 0, y: 0 });
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const detachRef = useRef<null | (() => void)>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom; // latest each render (a drag sees the live camera zoom)
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit; // a drag already in flight stops mutating if editing is locked

  useEffect(
    () => () => {
      mountedRef.current = false;
      detachRef.current?.();
      if (rafRef.current != null) cancelRaf(rafRef.current);
    },
    [],
  );

  const scheduleMove = (target: { x: number; y: number }) => {
    pendingRef.current = target;
    if (rafRef.current != null) return;
    const run = () => {
      rafRef.current = null;
      const t = pendingRef.current;
      if (!t || !mountedRef.current) return;
      if (!canEditRef.current) return; // editing was locked mid-drag
      const ok = moveObject(doc, note.id, t.x, t.y);
      if (!ok) endDrag(); // note vanished mid-drag
    };
    if (typeof requestAnimationFrame === 'function') {
      rafRef.current = requestAnimationFrame(run);
    } else {
      rafRef.current = setTimeout(run, 0) as unknown as number;
    }
  };

  const flushPending = () => {
    if (rafRef.current != null) {
      cancelRaf(rafRef.current);
      rafRef.current = null;
    }
    const t = pendingRef.current;
    pendingRef.current = null;
    if (t && mountedRef.current && canEditRef.current) moveObject(doc, note.id, t.x, t.y);
  };

  // Ends the drag: drops any pending rAF and reports the drag stopped.
  const endDrag = () => {
    if (rafRef.current != null) {
      cancelRaf(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    phaseRef.current = 'idle';
    detachRef.current?.();
    detachRef.current = null;
    onDragChange?.(note.id, false);
  };

  const onWindowMove = (e: PointerEvent) => {
    if (phaseRef.current === 'idle') return;
    if (!canEditRef.current) return; // locked while the pointer was down
    if (phaseRef.current === 'pressed') {
      const d = Math.hypot(e.clientX - startClientRef.current.x, e.clientY - startClientRef.current.y);
      if (d < DRAG_THRESHOLD_PX) return; // still Pressed
      phaseRef.current = 'dragging';
      if (mountedRef.current) bringToFront(doc, note.id);
      onDragChange?.(note.id, true);
    }
    const z = zoomRef.current || 1;
    const wx = startWorldRef.current.x + (e.clientX - startClientRef.current.x) / z;
    const wy = startWorldRef.current.y + (e.clientY - startClientRef.current.y) / z;
    scheduleMove({ x: wx, y: wy });
  };

  const onWindowUp = () => {
    const wasDragging = phaseRef.current === 'dragging';
    const wasPressed = phaseRef.current !== 'idle';
    if (wasDragging) flushPending();
    pendingRef.current = null;
    if (rafRef.current != null) {
      cancelRaf(rafRef.current);
      rafRef.current = null;
    }
    if (wasPressed && mountedRef.current) onSelect(note.id); // Pressed/Dragging -> Selected
    phaseRef.current = 'idle';
    detachRef.current?.();
    detachRef.current = null;
    if (wasDragging) onDragChange?.(note.id, false);
  };

  const onWindowCancel = () => {
    const wasDragging = phaseRef.current === 'dragging';
    if (wasDragging) {
      flushPending();
      if (mountedRef.current) onSelect(note.id); // keep the last shown position, selected
    }
    phaseRef.current = 'idle';
    detachRef.current?.();
    detachRef.current = null;
    if (wasDragging) onDragChange?.(note.id, false);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return; // the editor (textarea) owns its own pointer events
    if (e.button !== 0) return; // left button only
    e.stopPropagation(); // board must not pan
    if (!canEdit) {
      // Read-only board: selecting is allowed, moving is not (no window listeners,
      // so no drag and no raise).
      onSelect(note.id);
      return;
    }
    detachRef.current?.();
    const s = { x: e.clientX, y: e.clientY };
    startClientRef.current = s;
    startWorldRef.current = { x: note.x, y: note.y };
    pendingRef.current = null;
    phaseRef.current = 'pressed';

    const move = (ev: PointerEvent) => onWindowMove(ev);
    const up = () => onWindowUp();
    const cancel = () => onWindowCancel();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    detachRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // do not create a new note on the board
    if (!canEdit) return; // editing is locked while the board could not be loaded
    onStartEdit(note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-selected={selected ? 'true' : 'false'}
      data-note-id={note.id}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        boxSizing: 'border-box',
        padding: PADDING,
        background: STICKY_COLORS[note.color],
        color: '#2c2f36',
        borderRadius: 4,
        boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        overflow: 'hidden',
        zIndex: note.z,
        pointerEvents: 'auto',
        cursor: 'grab',
        outline: selected ? '2px solid #2f6fed' : 'none',
        outlineOffset: 1,
        userSelect: 'none',
      }}
    >
      <div
        data-testid="sticky-content"
        style={{
          position: 'absolute',
          inset: PADDING,
          overflow: 'hidden',
        }}
      >
        {editing && ytext ? (
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
        ) : (
          <div
            data-testid="sticky-text"
            className="sticky-note__text"
            style={{
              width: '100%',
              height: '100%',
              fontSize: fit.fontPx,
              lineHeight: LINE_HEIGHT,
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
              boxSizing: 'border-box',
            }}
          >
            {note.text}
          </div>
        )}
        {fit.overflow ? (
          <div
            data-testid="note-fade"
            className="sticky-note__fade"
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 28,
              pointerEvents: 'none',
              background: `linear-gradient(to bottom, rgba(255,255,255,0), ${STICKY_COLORS[note.color]})`,
            }}
          />
        ) : null}
      </div>

      {/* Off-screen measurement element for font auto-fit (same box as content). */}
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: INNER,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          lineHeight: LINE_HEIGHT,
          fontSize: `${fit.fontPx}px`,
          boxSizing: 'border-box',
        }}
      >
        {note.text}
      </div>
    </div>
  );
}

function cancelRaf(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}
