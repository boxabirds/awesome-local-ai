import { useRef, useLayoutEffect, useEffect, useState } from 'react';
import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
  type StickyColor,
} from '../../shared/config';
import { moveObject, bringToFront, getStickyText, type StickySnapshot } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const PADDING = 12;
const SELECTION_OUTLINE = '2px solid #1565C0';

interface Point {
  x: number;
  y: number;
}

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  /** Called when this note starts/stops being dragged (for toolbar visibility). */
  onDragStateChange?: (dragging: boolean) => void;
}

interface DragState {
  pressed: boolean;
  dragging: boolean;
  startScreen: Point;
  startWorld: Point;
  lastScreen: Point;
  rafId: number;
}

/**
 * A single sticky note: renders at world (x, y), handles select, drag-to-move,
 * and double-click-to-edit. Pointerdown stops propagation so the board never
 * pans when a note is grabbed. Dragging divides the screen delta by the camera
 * zoom so the grabbed point stays under the pointer at any zoom.
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
  onDragStateChange,
}: StickyNoteProps): React.ReactElement {
  const id = note.id;
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState<number>(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState<boolean>(false);

  const dragRef = useRef<DragState | null>(null);

  // Keep latest values available to the (stable) native pointer handlers.
  const noteRef = useRef(note);
  noteRef.current = note;
  const docRef = useRef(doc);
  docRef.current = doc;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDragStateChangeRef = useRef(onDragStateChange);
  onDragStateChangeRef.current = onDragStateChange;

  // Auto-fit the font to the note box when the text (or edit mode) changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const box = STICKY_SIZE_WORLD - 2 * PADDING;
    const { fontPx: fp, overflow: ov } = fitFontSize(el, box);
    setFontPx(fp);
    setOverflow(ov);
  }, [note.text, editing]);

  // Pointer interaction: select / drag-to-move.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const applyMove = () => {
      const ds = dragRef.current;
      if (!ds || !ds.dragging) return;
      const z = zoomRef.current;
      const dx = (ds.lastScreen.x - ds.startScreen.x) / z;
      const dy = (ds.lastScreen.y - ds.startScreen.y) / z;
      moveObject(docRef.current, id, ds.startWorld.x + dx, ds.startWorld.y + dy);
    };

    const scheduleMove = () => {
      const ds = dragRef.current;
      if (!ds || ds.rafId) return;
      ds.rafId = requestAnimationFrame(() => {
        ds.rafId = 0;
        applyMove();
      });
    };

    const release = (e: PointerEvent) => {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // never pan the board from a note
      el.setPointerCapture(e.pointerId);
      dragRef.current = {
        pressed: true,
        dragging: false,
        startScreen: { x: e.clientX, y: e.clientY },
        startWorld: { x: noteRef.current.x, y: noteRef.current.y },
        lastScreen: { x: e.clientX, y: e.clientY },
        rafId: 0,
      };
      onSelectRef.current(id);
    };

    const onPointerMove = (e: PointerEvent) => {
      const ds = dragRef.current;
      if (!ds || !ds.pressed) return;
      ds.lastScreen = { x: e.clientX, y: e.clientY };
      const dist = Math.hypot(e.clientX - ds.startScreen.x, e.clientY - ds.startScreen.y);
      if (!ds.dragging && dist >= DRAG_THRESHOLD_PX) {
        ds.dragging = true;
        bringToFront(docRef.current, id);
        onDragStateChangeRef.current?.(true);
      }
      if (ds.dragging) scheduleMove();
    };

    const finish = (e: PointerEvent, apply: boolean) => {
      const ds = dragRef.current;
      if (!ds) return;
      if (ds.rafId) {
        cancelAnimationFrame(ds.rafId);
        ds.rafId = 0;
      }
      const wasDragging = ds.dragging;
      if (apply && ds.dragging) applyMove();
      release(e);
      ds.pressed = false;
      ds.dragging = false;
      if (wasDragging) onDragStateChangeRef.current?.(false);
    };

    const onPointerUp = (e: PointerEvent) => finish(e, true);
    const onPointerCancel = (e: PointerEvent) => finish(e, false);
    const onLostCapture = () => {
      const ds = dragRef.current;
      if (ds) {
        ds.pressed = false;
        ds.dragging = false;
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('lostpointercapture', onLostCapture);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('lostpointercapture', onLostCapture);
      const ds = dragRef.current;
      if (ds?.rafId) cancelAnimationFrame(ds.rafId);
    };
  }, [id]);

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStartEdit(id);
  };

  const text = getStickyText(doc, id);
  const color = STICKY_COLORS[note.color as StickyColor] ?? STICKY_COLORS.yellow;

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Sticky note"
      data-testid={`sticky-note-${id}`}
      data-selected={selected || undefined}
      data-color={note.color}
      tabIndex={0}
      onDoubleClick={onDoubleClick}
      className={overflow && !editing ? 'sticky-note--overflow' : undefined}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        zIndex: note.z,
        background: color,
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        outline: selected ? SELECTION_OUTLINE : 'none',
        cursor: editing ? 'text' : 'grab',
        boxSizing: 'border-box',
        touchAction: 'none',
      }}
    >
      {editing && text ? (
        <StickyTextEditor ytext={text} fontPx={fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            padding: PADDING,
            display: 'flex',
            alignItems: overflow ? 'flex-start' : 'center',
            justifyContent: 'center',
          }}
        >
          <div
            ref={textRef}
            style={{
              whiteSpace: 'pre-wrap',
              textAlign: 'center',
              width: '100%',
              color: '#222',
              fontSize: `${fontPx}px`,
              lineHeight: 1.2,
            }}
          >
            {note.text}
          </div>
        </div>
      )}
      {overflow && !editing && (
        <div
          data-testid="sticky-overflow-fade"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 28,
            background: `linear-gradient(to bottom, transparent, ${color})`,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
