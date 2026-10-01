import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  bringToFront, deleteObject, getStickyText, moveObject, setStickyColor, type StickySnapshot,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD,
} from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const PRIMARY_BUTTON = 0;

interface Press {
  startX: number; startY: number; noteX: number; noteY: number;
  dragging: boolean; pending: { x: number; y: number } | null; raf: number | null;
}

export function StickyNote(props: {
  note: StickySnapshot; doc: Y.Doc; zoom: number;
  selected: boolean; editing: boolean;
  onSelect(id: string | null): void; onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}) {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const boxRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const latest = useRef({ note, zoom });
  latest.current = { note, zoom };

  useLayoutEffect(() => {
    if (boxRef.current) setFit(fitFontSize(boxRef.current, STICKY_SIZE_WORLD));
  }, [note.text]);

  const cancelFrame = (p: Press) => {
    if (p.raf !== null) cancelAnimationFrame(p.raf);
    p.raf = null;
  };
  useEffect(() => () => { if (press.current) cancelFrame(press.current); }, []);

  const endPress = () => {
    if (press.current) cancelFrame(press.current);
    press.current = null;
    setDragging(false);
  };

  const flush = (p: Press) => {
    p.raf = null;
    if (!p.pending) return;
    const { x, y } = p.pending;
    p.pending = null;
    if (!moveObject(doc, note.id, x, y) && !getStickyText(doc, note.id)) endPress();
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== PRIMARY_BUTTON) return;
    e.stopPropagation();
    if (editing) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    press.current = {
      startX: e.clientX, startY: e.clientY, noteX: note.x, noteY: note.y,
      dragging: false, pending: null, raf: null,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      p.dragging = true;
      setDragging(true);
      onSelect(note.id);
      bringToFront(doc, note.id);
    }
    const z = latest.current.zoom;
    p.pending = { x: p.noteX + dx / z, y: p.noteY + dy / z };
    if (p.raf === null) p.raf = requestAnimationFrame(() => flush(p));
  };

  const onPointerUp = () => {
    const p = press.current;
    if (!p) return;
    cancelFrame(p);
    if (p.dragging) flush(p);
    else onSelect(note.id);
    endPress();
  };

  // Pointer cancel / lost capture: keep the last applied position and stay selected.
  const onInterrupted = () => {
    if (press.current) endPress();
  };

  return (
    <div
      className="sticky-note"
      data-sticky-note=""
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: note.x, top: note.y, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[note.color], zIndex: note.z,
        outline: selected ? '3px solid #1a73e8' : 'none',
        cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onInterrupted}
      onLostPointerCapture={onInterrupted}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEdit(note.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget && !editing) {
          e.preventDefault();
          e.stopPropagation();
          onStartEdit(note.id);
        }
      }}
    >
      <div
        ref={boxRef}
        className={`sticky-text-box${fit.overflow ? ' sticky-overflow' : ''}`}
        data-testid="sticky-text"
        style={{ fontSize: fit.fontPx, visibility: editing ? 'hidden' : 'visible' }}
      >
        <div className="sticky-text">{note.text}</div>
      </div>
      {fit.overflow && <div className="sticky-fade" data-testid="sticky-fade" />}
      {editing && (() => {
        const ytext = getStickyText(doc, note.id);
        return ytext ? <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} /> : null;
      })()}
      {selected && !editing && !dragging && (
        <div className="note-toolbar-anchor" style={{ transform: `translateX(-50%) scale(${1 / zoom})` }}>
          <NoteToolbar
            color={note.color}
            onColor={(c) => { setStickyColor(doc, note.id, c); }}
            onDelete={() => {
              deleteObject(doc, note.id);
              onSelect(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
