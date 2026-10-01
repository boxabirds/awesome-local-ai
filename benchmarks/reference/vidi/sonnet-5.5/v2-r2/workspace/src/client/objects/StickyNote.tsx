import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  bringToFront, deleteObject, getStickyText, moveObject, setStickyColor, type StickySnapshot,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD, type StickyColor } from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { NOTE_PADDING, StickyTextEditor } from './StickyTextEditor';

interface Props {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** 1-based position in the stacking order (higher is on top). */
  stackIndex?: number;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

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

const LINE_HEIGHT = 1.25;

export function StickyNote({ note, doc, zoom, selected, editing, stackIndex, onSelect, onStartEdit, onEndEdit }: Props) {
  const { id } = note;
  const frameRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const frame = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const noteRef = useRef(note);
  noteRef.current = note;

  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false, padTop: NOTE_PADDING });

  // Text fit runs on mount and on text change only; zoom scales everything uniformly.
  useLayoutEffect(() => {
    const el = frameRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return;
    const { fontPx, overflow } = fitFontSize(el, STICKY_SIZE_WORLD);
    const padTop = Math.max(NOTE_PADDING, (STICKY_SIZE_WORLD - inner.offsetHeight) / 2);
    setFit((f) => (f.fontPx === fontPx && f.overflow === overflow && f.padTop === padTop ? f : { fontPx, overflow, padTop }));
  }, [note.text]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const applyMove = () => {
    frame.current = null;
    const p = press.current;
    if (!p || !p.dragging) return;
    const z = zoomRef.current;
    const moved = moveObject(
      doc, id, p.noteX + (p.lastX - p.startX) / z, p.noteY + (p.lastY - p.startY) / z,
    );
    // Note deleted meanwhile: end the drag silently.
    if (!moved && !getStickyText(doc, id)) finish(false);
  };

  const finish = (select: boolean) => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      applyMove();
    }
    const p = press.current;
    press.current = null;
    if (!p) return;
    setDragging(false);
    if (select && getStickyText(doc, id)) onSelect(id);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing) return;
    const n = noteRef.current;
    press.current = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      noteX: n.x, noteY: n.y, dragging: false, lastX: e.clientX, lastY: e.clientY,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    if (!p.dragging) {
      if (Math.hypot(p.lastX - p.startX, p.lastY - p.startY) < DRAG_THRESHOLD_PX) return;
      p.dragging = true;
      setDragging(true);
      onSelect(id);
      bringToFront(doc, id);
    }
    if (frame.current === null) frame.current = requestAnimationFrame(applyMove);
  };

  const onPointerEnd = () => finish(true);

  const color: StickyColor = note.color;
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-sticky-note=""
      data-note-id={id}
      data-selected={selected ? 'true' : 'false'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(id); }}
      onFocus={(e) => { if (e.target === e.currentTarget && !selected) onSelect(id); }}
      style={{
        position: 'absolute',
        zIndex: stackIndex,
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        boxSizing: 'border-box',
        background: STICKY_COLORS[color],
        boxShadow: '0 3px 10px rgba(0,0,0,0.25)',
        outline: selected ? '3px solid #1a73e8' : 'none',
        cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
        color: '#222',
      }}
    >
      <div
        ref={frameRef}
        data-testid="note-text"
        aria-hidden={editing || undefined}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          padding: NOTE_PADDING,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          visibility: editing ? 'hidden' : 'visible',
          font: `${fit.fontPx}px/${LINE_HEIGHT} system-ui, sans-serif`,
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        <div ref={innerRef} style={{ margin: 'auto 0' }}>{note.text}{note.text.endsWith('\n') ? '​' : ''}</div>
      </div>
      {fit.overflow && (
        <div
          className="sticky-fade"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 36,
            pointerEvents: 'none',
            background: `linear-gradient(to bottom, transparent, ${STICKY_COLORS[color]})`,
          }}
        />
      )}
      {editing && (() => {
        const ytext = getStickyText(doc, id);
        return ytext ? (
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} padTop={fit.padTop} onEnd={onEndEdit} />
        ) : null;
      })()}
      {showToolbar && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            width: STICKY_SIZE_WORLD,
            paddingBottom: 10,
            display: 'flex',
            justifyContent: 'center',
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'bottom center',
          }}
        >
          <NoteToolbar
            color={color}
            onColor={(c) => { setStickyColor(doc, id, c); }}
            onDelete={() => { deleteObject(doc, id); }}
          />
        </div>
      )}
    </div>
  );
}
