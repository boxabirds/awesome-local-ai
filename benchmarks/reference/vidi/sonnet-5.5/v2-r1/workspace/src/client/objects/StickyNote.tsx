import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { bringToFront, getStickyText, moveObject } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  noteX: number;
  noteY: number;
  dragging: boolean;
}

export function StickyNote(props: {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onDragChange?(dragging: boolean): void;
}) {
  const { note, doc, selected, editing } = props;
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const press = useRef<Press | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  const live = useRef(props);
  live.current = props;

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el, STICKY_SIZE_WORLD);
    setFit((prev) => (prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next));
  }, [note.text]);

  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  useEffect(
    () => () => {
      cancelFrame();
      if (press.current?.dragging) live.current.onDragChange?.(false);
      press.current = null;
    },
    [],
  );

  const writePending = (): boolean => {
    frame.current = null;
    const p = pending.current;
    pending.current = null;
    if (!p) return true;
    const ok = moveObject(doc, note.id, p.x, p.y);
    if (!ok && !doc.getMap('objects').has(note.id)) endPress(false);
    return ok;
  };

  const endPress = (select: boolean) => {
    const current = press.current;
    if (!current) return;
    press.current = null;
    cancelFrame();
    pending.current = null;
    if (current.dragging) props.onDragChange?.(false);
    if (select && doc.getMap('objects').has(note.id)) props.onSelect(note.id);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || editing) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    press.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      noteX: note.x,
      noteY: note.y,
      dragging: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      p.dragging = true;
      bringToFront(doc, note.id);
      props.onSelect(note.id);
      props.onDragChange?.(true);
    }
    pending.current = { x: p.noteX + dx / props.zoom, y: p.noteY + dy / props.zoom };
    if (frame.current === null) frame.current = requestAnimationFrame(writePending);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!press.current) return;
    if (press.current.dragging) {
      cancelFrame();
      writePending();
    }
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    endPress(true);
  };

  const onInterrupted = () => endPress(true);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-sticky-note=""
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      tabIndex={0}
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}${fit.overflow ? ' sticky-note--overflow' : ''}`}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[note.color],
        zIndex: note.z,
        cursor: editing ? 'text' : 'pointer',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onInterrupted}
      onLostPointerCapture={onInterrupted}
      onDoubleClick={(e) => {
        e.stopPropagation();
        props.onStartEdit(note.id);
      }}
    >
      <div
        ref={textRef}
        className="sticky-text"
        data-testid="sticky-text"
        style={{ fontSize: fit.fontPx, visibility: editing ? 'hidden' : 'visible' }}
      >
        <div className="sticky-text-inner">{note.text}</div>
      </div>
      {fit.overflow && <div className="sticky-fade" data-testid="sticky-fade" />}
      {editing && ytext && <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={props.onEndEdit} />}
    </div>
  );
}
