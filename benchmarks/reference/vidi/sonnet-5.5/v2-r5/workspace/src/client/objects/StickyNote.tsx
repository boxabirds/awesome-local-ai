import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
const NOTE_PADDING = 12;
const TOOLBAR_GAP_PX = 8;
const TEXT_BOX = STICKY_SIZE_WORLD - NOTE_PADDING * 2;

interface Press {
  pointerId: number;
  startX: number; startY: number;
  noteX: number; noteY: number;
  dragging: boolean;
  pending: { x: number; y: number } | null;
}

export function StickyNote(props: {
  note: StickySnapshot; doc: Y.Doc; zoom: number;
  selected: boolean; editing: boolean;
  onSelect(id: string): void; onStartEdit(id: string): void; onEndEdit(next: 'selected' | 'unselected'): void;
}) {
  const { note, doc, zoom, selected, editing } = props;
  const { id } = note;
  const press = useRef<Press | null>(null);
  const frame = useRef(0);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const noteRef = useRef(note);
  noteRef.current = note;
  const textRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el, TEXT_BOX);
    setFit((f) => (f.fontPx === next.fontPx && f.overflow === next.overflow ? f : next));
  }, [note.text]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const writePending = () => {
    frame.current = 0;
    const p = press.current;
    if (!p || !p.pending) return;
    const { x, y } = p.pending;
    p.pending = null;
    if (!moveObject(doc, id, x, y) && !getStickyText(doc, id)) {
      press.current = null; // note was deleted mid-drag
      setDragging(false);
    }
  };

  const finish = (flush: boolean) => {
    const p = press.current;
    if (!p) return;
    if (flush) writePending();
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    press.current = null;
    setDragging(false);
    if (getStickyText(doc, id)) props.onSelect(id);
  };

  return (
    <div
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-sticky=""
      data-id={id}
      data-x={note.x}
      data-y={note.y}
      data-selected={selected}
      data-editing={editing}
      data-dragging={dragging}
      className="sticky-note"
      style={{
        left: note.x, top: note.y, zIndex: note.z, width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[note.color], padding: NOTE_PADDING,
        outline: selected ? `${2 / zoom}px solid #2563eb` : 'none',
        cursor: dragging ? 'grabbing' : 'pointer',
      }}
      onPointerDown={(e) => {
        if (editing || (e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        press.current = {
          pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
          noteX: noteRef.current.x, noteY: noteRef.current.y, dragging: false, pending: null,
        };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || e.pointerId !== p.pointerId) return;
        const dx = e.clientX - p.startX;
        const dy = e.clientY - p.startY;
        if (!p.dragging) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          p.dragging = true;
          setDragging(true);
          bringToFront(doc, id);
        }
        p.pending = { x: p.noteX + dx / zoomRef.current, y: p.noteY + dy / zoomRef.current };
        if (!frame.current) frame.current = requestAnimationFrame(writePending);
      }}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onLostPointerCapture={() => finish(false)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        props.onStartEdit(id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget && !editing) {
          e.preventDefault();
          e.stopPropagation();
          props.onStartEdit(id);
        }
      }}
    >
      {selected && !editing && !dragging && (
        <div
          className="note-toolbar-anchor"
          style={{ transform: `translateX(-50%) scale(${1 / zoom})`, marginBottom: TOOLBAR_GAP_PX / zoom }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c) => { setStickyColor(doc, id, c); }}
            onDelete={() => { deleteObject(doc, id); }}
          />
        </div>
      )}
      <div
        className={`sticky-text-box${fit.overflow ? ' sticky-fade' : ''}`}
        style={{ visibility: editing ? 'hidden' : 'visible' }}
      >
        <div ref={textRef} className="sticky-text" style={{ fontSize: fit.fontPx }}>{note.text}</div>
      </div>
      {editing && (
        <StickyTextEditorHost doc={doc} id={id} fontPx={fit.fontPx} onEnd={props.onEndEdit} />
      )}
    </div>
  );
}

function StickyTextEditorHost(props: {
  doc: Y.Doc; id: string; fontPx: number; onEnd(next: 'selected' | 'unselected'): void;
}) {
  const ytext = getStickyText(props.doc, props.id);
  if (!ytext) return null; // note deleted while editing: no write, no re-creation
  return <StickyTextEditor ytext={ytext} fontPx={props.fontPx} onEnd={props.onEnd} />;
}
