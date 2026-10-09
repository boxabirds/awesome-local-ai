import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, JSX } from 'react';
import * as Y from 'yjs';
import { bringToFront, deleteObject, getStickyText, moveObject, setStickyColor, type StickySnapshot } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';
import {
  noteBodyStyle,
  noteFadeStyle,
  noteRootStyle,
  noteTextStyle,
  SELECTION_OUTLINE_COLOR,
  STICKY_TEXT_BOX_WORLD
} from './stickyStyles';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;
  const [dragging, setDragging] = useState(false);
  const [fontPx, setFontPx] = useState<number>(24);
  const [overflow, setOverflow] = useState(false);

  const measureRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startScreenRef = useRef({ x: 0, y: 0 });
  const startWorldRef = useRef({ x: 0, y: 0 });
  const pendingRef = useRef({ dx: 0, dy: 0 });
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (el === null) return;
    const result = fitFontSize(el, STICKY_TEXT_BOX_WORLD);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [note.text, editing]);

  useEffect(
    () => () => {
      draggingRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    []
  );

  const scheduleMove = useCallback((): void => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!draggingRef.current) return;
      const { dx, dy } = pendingRef.current;
      const z = zoomRef.current || 1;
      const ok = moveObject(doc, note.id, startWorldRef.current.x + dx / z, startWorldRef.current.y + dy / z);
      if (!ok) {
        draggingRef.current = false;
        setDragging(false);
        pointerIdRef.current = null;
      }
    });
  }, [doc, note.id]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerIdRef.current = event.pointerId;
    movedRef.current = false;
    draggingRef.current = false;
    startScreenRef.current = { x: event.clientX, y: event.clientY };
    startWorldRef.current = { x: note.x, y: note.y };
    pendingRef.current = { dx: 0, dy: 0 };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current === null) return;
    const dx = event.clientX - startScreenRef.current.x;
    const dy = event.clientY - startScreenRef.current.y;
    if (!draggingRef.current) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
      movedRef.current = true;
      setDragging(true);
      bringToFront(doc, note.id);
    }
    pendingRef.current = { dx, dy };
    scheduleMove();
  };

  const endPointer = (): void => {
    if (pointerIdRef.current === null) return;
    pointerIdRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    draggingRef.current = false;
    setDragging(false);
    onSelect(note.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    onStartEdit(note.id);
  };

  const rootStyle = {
    ...noteRootStyle,
    left: note.x,
    top: note.y,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    background: STICKY_COLORS[note.color],
    outline: selected ? `2px solid ${SELECTION_OUTLINE_COLOR}` : 'none',
    zIndex: note.z,
    cursor: dragging ? 'grabbing' : 'grab'
  };

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid={`sticky-${note.id}`}
      data-selected={selected}
      data-dragging={dragging}
      style={rootStyle}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
      onDoubleClick={onDoubleClick}
    >
      {editing ? (
        (() => {
          const ytext = getStickyText(doc, note.id);
          return ytext ? <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} /> : null;
        })()
      ) : (
        <div style={noteBodyStyle}>
          <div ref={measureRef} style={{ ...noteTextStyle, fontSize: fontPx }} data-testid={`sticky-text-${note.id}`}>
            {note.text}
          </div>
          {overflow ? <div data-testid="sticky-fade" style={noteFadeStyle} /> : null}
        </div>
      )}
      {selected && !editing && !dragging ? (
        <div
          data-testid={`note-toolbar-anchor-${note.id}`}
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            height: 0,
            transform: `scale(${1 / (zoom || 1)})`,
            transformOrigin: 'bottom left',
            pointerEvents: 'none'
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c: StickyColor) => {
              setStickyColor(doc, note.id, c);
            }}
            onDelete={() => {
              deleteObject(doc, note.id);
              onEndEdit('unselected');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
