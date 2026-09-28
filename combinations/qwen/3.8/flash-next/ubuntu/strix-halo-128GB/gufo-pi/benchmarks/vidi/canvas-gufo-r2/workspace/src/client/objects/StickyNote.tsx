/**
 * Sticky note rendering, selection, drag-to-move and text editing entry points.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import {
  bringToFront,
  moveObject,
  type StickySnapshot,
} from '../../shared/board-model';
import { StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';

interface DragState {
  startX: number;
  startY: number;
  pointerId: number;
  origX: number;
  origY: number;
}

type Phase = 'idle' | 'pressed' | 'dragging';

export function StickyNote(props: {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}): JSX.Element {
  const { note, doc, zoom, selected, editing } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Font fit measurement
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    // Measure using a detached element to get accurate scrollHeight independent
    // of the visible flex layout. The measurement matches .sticky-text's content
    // box: STICKY_SIZE_WORLD minus padding allowance.
    const el = measureRef.current;
    if (!el) return;
    const box = STICKY_SIZE_WORLD - 24; // padding allowance
    const result = fitFontSize(el, box);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [note.text]);

  const flushMove = useCallback(() => {
    rafRef.current = null;
    const pos = pendingPosRef.current;
    pendingPosRef.current = null;
    if (!pos) return;
    moveObject(doc, note.id, pos.x, pos.y);
  }, [doc, note.id]);

  const scheduleMove = useCallback(
    (x: number, y: number) => {
      pendingPosRef.current = { x, y };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushMove);
      }
    },
    [flushMove],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // Stop propagation so the board viewport does not start panning
      e.stopPropagation();
      // If editing this note, don't start a drag; let textarea handle events
      if (editing) return;

      const target = e.currentTarget as HTMLElement;
      if (typeof target.setPointerCapture === 'function') {
        try {
          target.setPointerCapture(e.pointerId);
        } catch {
          // jsdom best-effort
        }
      }
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        origX: note.x,
        origY: note.y,
      };
      phaseRef.current = 'pressed';
    },
    [editing, note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (phaseRef.current === 'pressed') {
        const dist = Math.hypot(dx, dy);
        if (dist < DRAG_THRESHOLD_PX) return;
        // Begin drag
        phaseRef.current = 'dragging';
        bringToFront(doc, note.id);
        props.onSelect(note.id);
      }
      // Convert screen delta to world delta: world delta = screen delta / zoom.
      const z = zoomRef.current;
      const wx = drag.origX + dx / z;
      const wy = drag.origY + dy / z;
      scheduleMove(wx, wy);
    },
    [doc, note.id, note.x, note.y, props, scheduleMove],
  );

  const endPointer = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const target = e.currentTarget as HTMLElement;
      if (typeof target.releasePointerCapture === 'function' && target.hasPointerCapture?.(drag.pointerId)) {
        try {
          target.releasePointerCapture(drag.pointerId);
        } catch {
          // ignore
        }
      }
      if (phaseRef.current === 'pressed') {
        // Short press without movement: select
        props.onSelect(note.id);
      }
      // If dragging, flush any pending move
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        const pos = pendingPosRef.current;
        pendingPosRef.current = null;
        if (pos) moveObject(doc, note.id, pos.x, pos.y);
      }
      dragRef.current = null;
      phaseRef.current = 'idle';
    },
    [doc, note.id, props],
  );

  const handleLostPointerCapture = useCallback(() => {
    // Drag interrupted (TC-21): note stays where last shown, become selected
    if (phaseRef.current === 'dragging') {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        const pos = pendingPosRef.current;
        pendingPosRef.current = null;
        if (pos) moveObject(doc, note.id, pos.x, pos.y);
      }
      props.onSelect(note.id);
    }
    dragRef.current = null;
    phaseRef.current = 'idle';
  }, [doc, note.id, props]);

  const handleDblClick = useCallback(
    (e: React.MouseEvent) => {
      // Stop propagation so BoardViewport doesn't create a new note
      e.stopPropagation();
      props.onStartEdit(note.id);
    },
    [note.id, props],
  );

  // Position in world layer (top-left at note.x, note.y)
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${STICKY_SIZE_WORLD}px`,
    height: `${STICKY_SIZE_WORLD}px`,
    backgroundColor: STICKY_COLORS[note.color],
    zIndex: note.z,
    pointerEvents: 'auto',
    touchAction: 'none',
  };

  return (
    <div
      ref={rootRef}
      className={`sticky-note${selected ? ' sticky-selected' : ''}`}
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : undefined}
      data-editing={editing ? 'true' : undefined}
      tabIndex={0}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDblClick}
    >
      {editing ? (
        <StickyTextEditor
          ytext={(doc.getMap('objects').get(note.id) as Y.Map<unknown>)?.get('text') as Y.Text}
          fontPx={fontPx}
          onEnd={props.onEndEdit}
        />
      ) : (
        <div
          className={`sticky-text${overflow ? ' sticky-text-overflow' : ''}`}
          style={{ fontSize: `${fontPx}px` }}
        >
          <span className="sticky-text-content">{note.text}</span>
        </div>
      )}
      {/* Hidden measurement element for font fit (matches content box of sticky-text) */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="sticky-text-measure"
      >
        {note.text}
      </div>
    </div>
  );
}
