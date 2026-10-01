import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  noteX: number;
  noteY: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
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
}) {
  const { note, doc, selected, editing } = props;
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const press = useRef<Press | null>(null);
  const frame = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ zoom: props.zoom, note });
  latest.current = { zoom: props.zoom, note };

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // Fit text on mount, text change and edit-mode change (zoom scales uniformly, so it is not a trigger).
  useLayoutEffect(() => {
    const el = contentRef.current?.querySelector<HTMLElement>('.sticky-textarea, .sticky-text');
    if (!el) return;
    const next = fitFontSize(el, el.clientHeight);
    setFit((prev) => (prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next));
  }, [note.text, editing]);

  const applyMove = () => {
    frame.current = null;
    const p = press.current;
    if (!p || !p.dragging) return;
    const { zoom } = latest.current;
    const ok = moveObject(
      doc,
      note.id,
      p.noteX + (p.lastX - p.startX) / zoom,
      p.noteY + (p.lastY - p.startY) / zoom,
    );
    if (!ok) endPress(); // note vanished mid-drag
  };

  const endPress = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    press.current = null;
    setDragging(false);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the board must not pan
    if (e.button !== 0 || editing) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    press.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      noteX: note.x,
      noteY: note.y,
      dragging: false,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    e.stopPropagation();
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD_PX) return;
      p.dragging = true;
      bringToFront(doc, note.id);
      props.onSelect(note.id);
      setDragging(true);
    }
    if (frame.current === null) frame.current = requestAnimationFrame(applyMove);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const p = press.current;
    if (!p) return;
    if (p.dragging) {
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      applyMove();
    } else {
      props.onSelect(note.id);
    }
    endPress();
  };

  const onCancel = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const p = press.current;
    if (!p) return;
    if (p.dragging) props.onSelect(note.id); // keep the last shown position
    endPress();
  };

  const color = STICKY_COLORS[note.color];
  const showToolbar = selected && !dragging && !editing;
  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      className={`sticky-note${fit.overflow ? ' sticky-overflow' : ''}`}
      role="group"
      aria-label="Sticky note"
      data-sticky-note=""
      data-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-color={note.color}
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: color,
        zIndex: note.z,
        outline: selected ? '3px solid #3b6ef5' : 'none',
        cursor: dragging ? 'grabbing' : 'pointer',
      }}
      onFocus={() => {
        if (!selected && !press.current) props.onSelect(note.id);
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onCancel}
      onLostPointerCapture={onCancel}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing) props.onStartEdit(note.id);
      }}
    >
      <div ref={contentRef} className="sticky-content">
        {editing && ytext ? (
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={props.onEndEdit} />
        ) : (
          <div className="sticky-text" style={{ fontSize: fit.fontPx }}>
            {note.text}
          </div>
        )}
      </div>
      {fit.overflow && <div className="sticky-fade" data-testid="sticky-fade" />}
      {showToolbar && (
        <div className="note-toolbar-anchor" style={{ transform: `translateX(-50%) scale(${1 / props.zoom})` }}>
          <NoteToolbar
            color={note.color}
            onColor={(c) => setStickyColor(doc, note.id, c)}
            onDelete={() => deleteObject(doc, note.id)}
          />
        </div>
      )}
    </div>
  );
}
