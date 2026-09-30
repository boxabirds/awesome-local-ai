import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { bringToFront, getStickyText, moveObject, type StickySnapshot } from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const TEXT_BOX_WORLD = STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD;
const HALF = 2;

type Phase = 'idle' | 'pressed' | 'dragging';

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  noteX: number;
  noteY: number;
}

/**
 * One sticky note in the world layer: select on click, drag to move, double-click
 * to edit. Interaction state is local; only positions/text go to the document.
 */
export function StickyNote(props: {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Stacking position among rendered objects (render order stays stable during drags). */
  zIndex?: number;
  /** Reports Dragging on/off so the note toolbar can hide while dragging. */
  onDragChange?(dragging: boolean): void;
  /** No dragging or editing (the board could not be loaded, story 4). Selection still works. */
  readOnly?: boolean;
}) {
  const { note, doc } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false, padTop: 0 });
  const pressRef = useRef<Press | null>(null);
  const draggingRef = useRef(false);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const zoomRef = useRef(props.zoom);
  zoomRef.current = props.zoom;
  const propsRef = useRef(props);
  propsRef.current = props;

  // Auto-fit on text change (the font is in board units, so zoom never changes the fit).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const result = fitFontSize(el, TEXT_BOX_WORLD);
    const contentHeight = contentRef.current?.offsetHeight ?? 0;
    const padTop = STICKY_PADDING_WORLD + Math.max(0, (TEXT_BOX_WORLD - contentHeight) / HALF);
    setFit((f) =>
      f.fontPx === result.fontPx && f.overflow === result.overflow && f.padTop === padTop
        ? f
        : { ...result, padTop },
    );
  }, [note.text]);

  // Leaving edit mode with the note still selected keeps keyboard focus on it.
  const wasEditing = useRef(props.editing);
  useEffect(() => {
    if (wasEditing.current && !props.editing && props.selected) {
      rootRef.current?.focus({ preventScroll: true });
    }
    wasEditing.current = props.editing;
  }, [props.editing, props.selected]);

  // Unmount (e.g. the note was deleted mid-drag): end silently, write nothing.
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (draggingRef.current) propsRef.current.onDragChange?.(false);
    },
    [],
  );

  const applyPending = () => {
    frameRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next && !propsRef.current.readOnly) moveObject(doc, note.id, next.x, next.y);
  };

  const finish = (commitPending: boolean) => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (commitPending) applyPending();
    pendingRef.current = null;
    const wasDragging = draggingRef.current;
    pressRef.current = null;
    draggingRef.current = false;
    setPhase('idle');
    if (wasDragging) props.onDragChange?.(false);
    props.onSelect(note.id);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the board must not pan
    if (props.editing) {
      // Clicks on the note's padding must not steal focus from the textarea.
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      return;
    }
    if (e.button !== 0 || pressRef.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Unavailable for synthetic events; dragging still works via bubbling.
    }
    pressRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, noteX: note.x, noteY: note.y };
    setPhase('pressed');
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (!draggingRef.current) {
      if (propsRef.current.readOnly) return;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
      setPhase('dragging');
      props.onSelect(note.id);
      props.onDragChange?.(true);
      bringToFront(doc, note.id);
    }
    const zoom = zoomRef.current;
    pendingRef.current = { x: press.noteX + dx / zoom, y: press.noteY + dy / zoom };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(applyPending);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    finish(true);
  };

  // Cancelled / interrupted drag: keep the last applied position.
  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    finish(false);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // never creates a note underneath
    if (!props.editing && !props.readOnly) props.onStartEdit(note.id);
  };

  const ytext = props.editing ? getStickyText(doc, note.id) : undefined;
  const editing = props.editing && ytext !== undefined;

  return (
    <div
      ref={rootRef}
      className={`sticky-note${props.selected ? ' is-selected' : ''}${phase === 'dragging' ? ' is-dragging' : ''}`}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-note-id={note.id}
      data-selected={props.selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-state={phase}
      data-x={note.x}
      data-y={note.y}
      data-z={note.z}
      data-color={note.color}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: STICKY_COLORS[note.color],
        zIndex: props.zIndex,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={textRef}
        className={`sticky-text${fit.overflow ? ' is-overflowing' : ''}`}
        data-testid="sticky-text"
        style={{
          fontSize: `${fit.fontPx}px`,
          inset: STICKY_PADDING_WORLD,
          visibility: editing ? 'hidden' : undefined,
        }}
        aria-hidden={editing ? true : undefined}
      >
        <div ref={contentRef} className="sticky-text-content">
          {note.text}
        </div>
      </div>
      {editing && ytext && (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} padTop={fit.padTop} onEnd={props.onEndEdit} />
      )}
    </div>
  );
}
