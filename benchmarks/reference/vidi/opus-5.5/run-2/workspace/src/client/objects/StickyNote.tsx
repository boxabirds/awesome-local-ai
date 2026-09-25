/**
 * One sticky note in the world layer (anchors: sticky.interaction, sticky.select,
 * sticky.move, sticky.no_pan, sticky.text_fit).
 *
 * Per-note interaction states: Unselected → Pressed (pointerdown) → Selected (pointerup
 * within DRAG_THRESHOLD_PX) or Dragging (moved at least DRAG_THRESHOLD_PX) → Selected
 * (pointerup / pointercancel / lost capture). Editing is driven by the parent's selection
 * state. If the note is deleted meanwhile, the component unmounts and the interaction
 * simply ends (pending frames are cancelled; the model rejects stale ids).
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type * as Y from 'yjs';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  hasObject,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  NOTE_TOOLBAR_GAP_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_LINE_HEIGHT,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const PRIMARY_BUTTON = 0;
/**
 * Stacking of the floating note toolbar inside the world layer: above every note
 * (notes use their document `z` as z-index, which grows by one per bring-to-front).
 */
const NOTE_TOOLBAR_Z_INDEX = 2_147_483_647;
const HALF = 2;
/** Height available to text inside the note, in world units. */
const TEXT_BOX = STICKY_SIZE_WORLD - HALF * STICKY_PADDING_WORLD;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** False while the board cannot be edited (story 4 load failure): no drag, edit, colour or delete. */
  editable?: boolean;
}

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  noteX: number;
  noteY: number;
  zoom: number;
  dragging: boolean;
}

function StickyNoteImpl(props: StickyNoteProps): React.JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;
  const editable = props.editable ?? true;
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const pointerActive = useRef(false);
  const frame = useRef<number | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false, offsetTop: 0 });

  // The world layer (this note's parent) hosts the floating toolbar.
  const [worldLayer, setWorldLayer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setWorldLayer(rootRef.current?.parentElement ?? null);
  }, []);

  const ytext = useMemo(() => getStickyText(doc, note.id), [doc, note.id]);

  // Text fit: on mount and whenever the text changes (zoom scales everything uniformly).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el === null) return;
    const result = fitFontSize(el, TEXT_BOX);
    // An empty note still has one (caret) line when editing.
    const contentHeight = Math.max(contentRef.current?.offsetHeight ?? 0, result.fontPx * STICKY_LINE_HEIGHT);
    const offsetTop = result.overflow ? 0 : Math.max(0, (TEXT_BOX - contentHeight) / HALF);
    setFit((f) =>
      f.fontPx === result.fontPx && f.overflow === result.overflow && f.offsetTop === offsetTop
        ? f
        : { ...result, offsetTop },
    );
  }, [note.text]);

  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(() => cancelFrame, []);

  const endDrag = useCallback(() => {
    cancelFrame();
    pending.current = null;
    press.current = null;
    pointerActive.current = false;
    setDragging(false);
  }, []);

  /** Writes the latest pending position; ends the drag if the note has been deleted. */
  const flushMove = useCallback(() => {
    frame.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    if (!moveObject(doc, note.id, next.x, next.y) && !hasObject(doc, note.id)) endDrag();
  }, [doc, note.id, endDrag]);

  // Leaving edit mode with the note still selected keeps keyboard focus on the note.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing && selected) rootRef.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing, selected]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // The board must never pan (or clear the selection) because of a press on a note.
    e.stopPropagation();
    if (editing || e.button !== PRIMARY_BUTTON) return;
    pointerActive.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    press.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      noteX: note.x,
      noteY: note.y,
      zoom,
      dragging: false,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p === null || e.pointerId !== p.pointerId) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.dragging) {
      if (!editable || Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!hasObject(doc, note.id)) {
        endDrag();
        return;
      }
      p.dragging = true;
      setDragging(true);
      // The dragged note becomes the selected one (its toolbar stays hidden until release).
      onSelect(note.id);
      bringToFront(doc, note.id);
    }
    pending.current = { x: p.noteX + dx / p.zoom, y: p.noteY + dy / p.zoom };
    if (frame.current === null) frame.current = requestAnimationFrame(flushMove);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p === null || e.pointerId !== p.pointerId) return;
    e.stopPropagation();
    if (p.dragging) {
      cancelFrame();
      flushMove(); // the release point is where the note ends up
    }
    endDrag();
    if (hasObject(doc, note.id)) onSelect(note.id);
  };

  /** Interrupted drag: the note stays where it was last shown. */
  const onPointerInterrupted = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p === null || e.pointerId !== p.pointerId) return;
    endDrag();
    if (hasObject(doc, note.id)) onSelect(note.id);
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && editable) onStartEdit(note.id);
  };

  // Keyboard focus (Tab) selects the note; pointer focus is handled by pointerup.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || pointerActive.current || selected) return;
    onSelect(note.id);
  };

  const onColor = useCallback((c: StickyColor) => setStickyColor(doc, note.id, c), [doc, note.id]);
  const onDelete = useCallback(() => deleteObject(doc, note.id), [doc, note.id]);

  const style = {
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${STICKY_SIZE_WORLD}px`,
    height: `${STICKY_SIZE_WORLD}px`,
    // Stacking follows the document's z; equal z falls back to DOM order, which is by id.
    zIndex: note.z,
    backgroundColor: STICKY_COLORS[note.color],
    '--note-bg': STICKY_COLORS[note.color],
    '--zoom': String(zoom),
    '--sticky-padding': `${STICKY_PADDING_WORLD}px`,
    lineHeight: String(STICKY_LINE_HEIGHT),
  } as CSSProperties;

  // The toolbar lives in the world layer (portal) at the note's top centre, above all
  // notes, and is scaled by 1/zoom so it keeps its screen size at every zoom.
  const toolbarStyle: CSSProperties = {
    left: `${note.x + STICKY_SIZE_WORLD / HALF}px`,
    top: `${note.y}px`,
    zIndex: NOTE_TOOLBAR_Z_INDEX,
    transform: `scale(${1 / zoom})`,
  };
  const showToolbar = editable && selected && !editing && !dragging && worldLayer !== null;

  const state = editing ? 'editing' : dragging ? 'dragging' : selected ? 'selected' : 'unselected';

  return (
    <div
      ref={rootRef}
      className={`sticky-note${fit.overflow ? ' sticky-fade' : ''}`}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-id={note.id}
      data-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      data-state={state}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerInterrupted}
      onLostPointerCapture={onPointerInterrupted}
      onDoubleClick={onDoubleClick}
      onFocus={onFocus}
    >
      <div
        ref={textRef}
        className="sticky-text"
        data-testid="sticky-text"
        style={{ fontSize: `${fit.fontPx}px`, visibility: editing ? 'hidden' : undefined }}
      >
        <div ref={contentRef} className="sticky-text-content">
          {note.text}
        </div>
      </div>
      {editing && editable && ytext !== undefined && (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} offsetTop={fit.offsetTop} onEnd={onEndEdit} />
      )}
      {showToolbar &&
        createPortal(
          <div className="note-toolbar-anchor" style={toolbarStyle}>
            <div className="note-toolbar-position" style={{ bottom: `${NOTE_TOOLBAR_GAP_PX}px` }}>
              <NoteToolbar color={note.color} onColor={onColor} onDelete={onDelete} />
            </div>
          </div>,
          worldLayer,
        )}
    </div>
  );
}

export const StickyNote = memo(StickyNoteImpl);
