import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { bringToFront, deleteObject, getStickyText, moveObject, setStickyColor, type StickySnapshot } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { StickyTextEditor, STICKY_LINE_HEIGHT, STICKY_PADDING_WORLD } from './StickyTextEditor';

const SELECT_OUTLINE = '3px solid #1e88e5';
const TOOLBAR_GAP_PX = 10;
const FADE_HEIGHT = 40;
const TEXT_BOX = STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD;

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  noteX: number;
  noteY: number;
  dragging: boolean;
  pending: { x: number; y: number } | null;
  frame: number | null;
}

export function StickyNote(props: {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}) {
  const { note, doc, zoom, selected, editing } = props;
  const textRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el, TEXT_BOX);
    setFit((f) => (f.fontPx === next.fontPx && f.overflow === next.overflow ? f : next));
  }, [note.text]);

  const cancelFrame = (p: Press) => {
    if (p.frame !== null) cancelAnimationFrame(p.frame);
    p.frame = null;
  };
  const flushMove = (p: Press) => {
    cancelFrame(p);
    if (p.pending) {
      const { x, y } = p.pending;
      p.pending = null;
      if (!moveObject(doc, noteRef.current.id, x, y)) press.current = null;
    }
  };
  const endPress = () => {
    const p = press.current;
    if (!p) return;
    flushMove(p);
    press.current = null;
    setDragging(false);
  };

  useEffect(
    () => () => {
      if (press.current) cancelFrame(press.current);
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    press.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      noteX: note.x,
      noteY: note.y,
      dragging: false,
      pending: null,
      frame: null,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      p.dragging = true;
      setDragging(true);
      props.onSelect(note.id);
      bringToFront(doc, note.id);
    }
    p.pending = { x: p.noteX + dx / zoomRef.current, y: p.noteY + dy / zoomRef.current };
    if (p.frame === null) {
      p.frame = requestAnimationFrame(() => {
        p.frame = null;
        flushMove(p);
      });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const wasDrag = p.dragging;
    endPress();
    if (!wasDrag) props.onSelect(note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const showEditor = editing && ytext !== undefined;
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-selected={selected ? 'true' : 'false'}
      data-note-id={note.id}
      data-z={note.z}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endPress}
      onLostPointerCapture={endPress}
      onDoubleClick={(e) => {
        e.stopPropagation();
        props.onStartEdit(note.id);
      }}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        zIndex: note.z,
        boxSizing: 'border-box',
        background: STICKY_COLORS[note.color],
        boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
        outline: selected ? SELECT_OUTLINE : 'none',
        cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: editing ? 'text' : 'none',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div
          ref={textRef}
          data-testid="note-text"
          data-overflow={fit.overflow ? 'true' : 'false'}
          style={{
            position: 'absolute',
            left: STICKY_PADDING_WORLD,
            right: STICKY_PADDING_WORLD,
            top: fit.overflow ? STICKY_PADDING_WORLD : '50%',
            transform: fit.overflow ? 'none' : 'translateY(-50%)',
            fontSize: fit.fontPx,
            lineHeight: STICKY_LINE_HEIGHT,
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            color: '#222',
            visibility: editing ? 'hidden' : 'visible',
            pointerEvents: 'none',
          }}
        >
          {note.text}
        </div>
        {showEditor && (
          <div
            style={{
              position: 'absolute',
              left: STICKY_PADDING_WORLD,
              right: STICKY_PADDING_WORLD,
              top: STICKY_PADDING_WORLD,
              bottom: STICKY_PADDING_WORLD,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: fit.overflow ? 'flex-start' : 'center',
            }}
          >
            <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={props.onEndEdit} />
          </div>
        )}
        {fit.overflow && (
          <div
            data-testid="note-fade"
            className="sticky-fade"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: FADE_HEIGHT,
              background: `linear-gradient(to bottom, transparent, ${STICKY_COLORS[note.color]})`,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      {showToolbar && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            paddingBottom: TOOLBAR_GAP_PX,
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'left bottom',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c) => setStickyColor(doc, note.id, c)}
            onDelete={() => {
              deleteObject(doc, note.id);
              props.onSelect(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
