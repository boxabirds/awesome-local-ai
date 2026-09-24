import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
  getStickyText,
  hasObject,
  moveObject,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import type { EndEditNext } from '../board/useSelection';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

/** Only the primary (left) mouse button selects or drags. */
const PRIMARY_BUTTON = 0;
/** Selection outline thickness in screen px (kept constant at every zoom). */
const OUTLINE_SCREEN_PX = 2;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  /** Rank in (z, id) order, used as CSS z-index; the DOM order stays stable during drags. */
  stackIndex?: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
  /** Reports when a drag of this note starts and ends (the note toolbar hides while dragging). */
  onDragChange?(id: string, dragging: boolean): void;
  /** The board cannot be edited: presses still select, but never drag or start editing. */
  readOnly?: boolean;
}

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  noteX: number;
  noteY: number;
  dragging: boolean;
  /** Latest target position not yet written (rAF-throttled). */
  pending: { x: number; y: number } | null;
  frame: number | null;
}

type Fit = { fontPx: number; overflow: boolean };

/**
 * One sticky note in the world layer: press to select, drag to move (grabbed point stays under
 * the pointer at any zoom), double-click to edit. Pointer presses never reach the board, so
 * dragging a note never pans.
 */
function StickyNoteImpl(props: StickyNoteProps) {
  const { note, doc, zoom, stackIndex, selected, editing, onSelect, onStartEdit, onEndEdit, onDragChange, readOnly = false } =
    props;
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<Press | null>(null);
  const pointerFocusRef = useRef(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const [fit, setFit] = useState<Fit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const [dragging, setDragging] = useState(false);

  // Largest font at which the text fits; font is in world units, so zoom never changes the fit.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const next = fitFontSize(el, STICKY_SIZE_WORLD);
    setFit((f) => (f.fontPx === next.fontPx && f.overflow === next.overflow ? f : next));
  }, [note.text]);

  const flush = (press: Press): boolean => {
    press.frame = null;
    const target = press.pending;
    press.pending = null;
    if (!hasObject(doc, note.id)) return false;
    if (target) moveObject(doc, note.id, target.x, target.y);
    return true;
  };

  const finish = (commitPending: boolean) => {
    const press = pressRef.current;
    if (!press) return;
    pressRef.current = null;
    if (press.frame !== null) cancelAnimationFrame(press.frame);
    if (commitPending) flush(press);
    try {
      if (rootRef.current?.hasPointerCapture?.(press.pointerId)) {
        rootRef.current.releasePointerCapture(press.pointerId);
      }
    } catch {
      // Already released.
    }
    if (press.dragging) {
      setDragging(false);
      onDragChange?.(note.id, false);
    }
    if (hasObject(doc, note.id)) onSelect(note.id);
  };

  // Unmount (e.g. note deleted mid-drag): drop any pending frame; nothing is written.
  useEffect(
    () => () => {
      const press = pressRef.current;
      pressRef.current = null;
      if (press?.frame != null) cancelAnimationFrame(press.frame);
      if (press?.dragging) onDragChange?.(note.id, false);
    },
    // Mount/unmount only: the refs hold the live drag state.
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The board must neither pan nor clear the selection.
    e.stopPropagation();
    if (editing || e.button !== PRIMARY_BUTTON || pressRef.current) return;
    pointerFocusRef.current = true;
    pressRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      noteX: note.x,
      noteY: note.y,
      dragging: false,
      pending: null,
      frame: null,
    };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Capture can fail if the pointer is already gone.
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    if (press.dragging && readOnlyRef.current) {
      // Editing was disabled mid-drag: the note stays where it was last shown.
      finish(false);
      return;
    }
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (!press.dragging) {
      if (readOnlyRef.current || Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!hasObject(doc, note.id)) {
        finish(false);
        return;
      }
      press.dragging = true;
      bringToFront(doc, note.id);
      setDragging(true);
      onDragChange?.(note.id, true);
    }
    press.pending = { x: press.noteX + dx / zoomRef.current, y: press.noteY + dy / zoomRef.current };
    if (press.frame === null) {
      press.frame = requestAnimationFrame(() => {
        if (pressRef.current !== press) return;
        if (!flush(press)) finish(false);
      });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    if (press.dragging) {
      press.pending = {
        x: press.noteX + (e.clientX - press.startX) / zoomRef.current,
        y: press.noteY + (e.clientY - press.startY) / zoomRef.current,
      };
    }
    finish(true);
  };

  // Interrupted drag: the note stays where it was last shown.
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    finish(false);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && !readOnly) onStartEdit(note.id);
  };

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    // While editing, presses on the note's padding keep focus in the textarea.
    if (editing && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
  };

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    // Keyboard (Tab) focus selects the note so Enter / Delete act on it.
    if (e.target !== e.currentTarget) return;
    const fromPointer = pointerFocusRef.current;
    pointerFocusRef.current = false;
    if (!fromPointer && !selected) onSelect(note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const style: CSSProperties = {
    transform: `translate(${note.x}px, ${note.y}px)`,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    backgroundColor: STICKY_COLORS[note.color],
    zIndex: stackIndex,
    outlineWidth: selected ? `${OUTLINE_SCREEN_PX / zoom}px` : undefined,
  };

  const className = [
    'sticky-note',
    selected && 'sticky-note--selected',
    dragging && 'sticky-note--dragging',
    editing && 'sticky-note--editing',
    fit.overflow && 'sticky-note--overflow',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={rootRef}
      className={className}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-color={note.color}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onFocus={onFocus}
    >
      <div ref={bodyRef} className="sticky-note__body" style={{ fontSize: `${fit.fontPx}px` }}>
        <div className="sticky-note__text" data-testid="sticky-text">
          {note.text}
        </div>
        {ytext && <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />}
      </div>
      {fit.overflow && (
        <div
          className="sticky-note__fade"
          aria-hidden="true"
          style={{ backgroundImage: `linear-gradient(to bottom, transparent, ${STICKY_COLORS[note.color]})` }}
        />
      )}
    </div>
  );
}

export const StickyNote = memo(StickyNoteImpl);
