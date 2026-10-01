import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import type { EndEditNext } from '../board/useSelection';
import { NoteToolbar } from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

export interface StickyNoteProps {
  /** The note as stored in the document: position, colour and text. */
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, used to keep the grabbed point under the pointer. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  /** The note's world position when the pointer went down. */
  originX: number;
  originY: number;
}

/**
 * One sticky note: a square of colour in the world layer that can be
 * selected, dragged, recoloured, typed into and deleted.
 *
 * Interaction states (per note, never written to the document):
 * unselected -> pressed (pointerdown) -> selected (pointerup within
 * DRAG_THRESHOLD_PX) or dragging (moved at least the threshold); dragging ->
 * selected on pointerup/pointercancel; selected -> editing (dblclick or
 * Enter); editing -> selected (Escape) or unselected (click outside).
 */
export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing } = props;
  const propsRef = useRef(props);
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  const pressRef = useRef<Press | null>(null);
  const draggingRef = useRef(false);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);
  const zoomRef = useRef(zoom);

  useLayoutEffect(() => {
    propsRef.current = props;
    zoomRef.current = zoom;
  });

  useEffect(() => {
    return () => {
      // Unmounted mid-drag (the note was deleted): never leave a frame queued.
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, []);

  /** Write the newest pointer position into the document. */
  const applyPending = useCallback(() => {
    const target = pendingRef.current;
    pendingRef.current = null;
    if (target === null) return;
    // The note may be gone by now (deleted while this drag was in flight);
    // then the interaction simply ends, it never re-creates the note.
    if (!moveObject(doc, propsRef.current.note.id, target.x, target.y)) {
      pressRef.current = null;
      draggingRef.current = false;
      setPressed(false);
      setDragging(false);
    }
  }, [doc]);

  /** At most one write per animation frame, however many pointermoves arrive. */
  const scheduleApply = useCallback(() => {
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      applyPending();
    });
  }, [applyPending]);

  /** Auto-fit: largest readable font size that keeps the text inside. */
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el === null) return;
    const next = fitFontSize(el, el.clientHeight);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [note.text, note.id, editing]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (propsRef.current.editing) {
      // Typing/caret placement inside the note's own textarea.
      e.stopPropagation();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A press on a note is never a pan: the viewport must not see it.
    e.stopPropagation();
    pressRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: note.x,
      originY: note.y,
    };
    draggingRef.current = false;
    pendingRef.current = null;
    setPressed(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported here; the drag still works while the pointer is inside */
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (press === null || e.pointerId !== press.pointerId) return;
    e.stopPropagation();
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (!draggingRef.current) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a short press
      draggingRef.current = true;
      setDragging(true);
      // Once, so the dragged note is drawn above everything it overlaps.
      bringToFront(doc, note.id);
    }
    const z = zoomRef.current > 0 ? zoomRef.current : 1;
    // Dividing the screen delta by the camera zoom keeps the grabbed point
    // under the pointer at 50 %, 100 % or 200 %.
    pendingRef.current = { x: press.originX + dx / z, y: press.originY + dy / z };
    scheduleApply();
  };

  const endPress = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (press === null || e.pointerId !== press.pointerId) return;
    e.stopPropagation();
    const wasDragging = draggingRef.current;
    pressRef.current = null;
    draggingRef.current = false;
    setPressed(false);
    if (wasDragging) setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    // The last position lands immediately, so the note ends exactly under the
    // pointer (and a cancelled drag keeps the position it was shown at).
    applyPending();
    propsRef.current.onSelect(note.id);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Editing this note; the viewport must not create another one here.
    e.stopPropagation();
    propsRef.current.onStartEdit(note.id);
  };

  const onColor = (color: StickyColor) => {
    setStickyColor(doc, note.id, color);
  };

  const onDelete = () => {
    deleteObject(doc, note.id);
  };

  const ytext = getStickyText(doc, note.id);
  const state = editing ? 'editing' : dragging ? 'dragging' : pressed ? 'pressed' : selected ? 'selected' : 'unselected';
  const style = {
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${STICKY_SIZE_WORLD}px`,
    height: `${STICKY_SIZE_WORLD}px`,
    backgroundColor: STICKY_COLORS[note.color],
    fontSize: `${fit.fontPx}px`,
    // Stacking is done by z-index, not by DOM order, so that bringing a note to
    // the front never moves its element (which would drop pointer capture).
    zIndex: note.z,
    '--note-inv-zoom': String(1 / (zoom > 0 ? zoom : 1)),
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-state={state}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-testid="sticky-note"
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onLostPointerCapture={endPress}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={textRef}
        className={`sticky-text${fit.overflow ? ' has-fade' : ''}${editing ? ' is-hidden-by-editor' : ''}`}
        data-testid="sticky-text"
        aria-hidden={editing ? 'true' : undefined}
      >
        {note.text}
      </div>
      {editing && ytext !== undefined ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fit.fontPx}
          onEnd={(next) => {
            propsRef.current.onEndEdit(next);
          }}
        />
      ) : null}
      {selected && !editing && !dragging ? (
        <NoteToolbar color={note.color} onColor={onColor} onDelete={onDelete} />
      ) : null}
    </div>
  );
}
