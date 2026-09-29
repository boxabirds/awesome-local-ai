import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type * as Y from 'yjs';
import {
  type StickySnapshot,
  bringToFront,
  deleteObject,
  getStickyText,
  hasObject,
  moveObject,
  setStickyColor,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const PRIMARY_BUTTON = 0;

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  zoom: number;
  dragging: boolean;
  pending: { x: number; y: number } | null;
  frame: number | null;
}

interface Fit {
  fontPx: number;
  overflow: boolean;
  /** Height of the text itself (without padding), world units. */
  textHeight: number;
}

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** CSS stacking layer: the note's rank in (z, id) order. DOM order stays stable while dragging. */
  layer?: number;
  /** False while the board is locked: no drag, selection, editing, colour or delete. */
  editable?: boolean;
}

/** A pre-wrap block shows no trailing empty line; a textarea does. Keep them the same height. */
function measurable(text: string): string {
  return text.endsWith('\n') || text === '' ? `${text}​` : text;
}

export function StickyNote(props: StickyNoteProps) {
  const { note, doc, zoom, selected, editing } = props;
  const editable = props.editable ?? true;
  const noteRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<Fit>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
    textHeight: 0,
  });
  const ytext = useMemo(
    () => (editing ? getStickyText(doc, note.id) : undefined),
    [doc, note.id, editing],
  );

  // Font fit runs on text change only: the font is in world units, so zoom scales it uniformly.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const { fontPx, overflow } = fitFontSize(el, STICKY_SIZE_WORLD);
    const style = getComputedStyle(el);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) || 0;
    const textHeight = Math.max(0, el.scrollHeight - padding);
    setFit((prev) =>
      prev.fontPx === fontPx && prev.overflow === overflow && prev.textHeight === textHeight
        ? prev
        : { fontPx, overflow, textHeight },
    );
  }, [note.text]);

  const cancelFrame = (g: Gesture) => {
    if (g.frame !== null) cancelAnimationFrame(g.frame);
    g.frame = null;
  };

  const finish = (select: boolean) => {
    const g = gestureRef.current;
    if (!g) return;
    cancelFrame(g);
    gestureRef.current = null;
    setDragging(false);
    if (select && hasObject(doc, note.id)) props.onSelect(note.id);
  };

  const applyPending = (g: Gesture) => {
    const p = g.pending;
    g.pending = null;
    if (!p) return;
    // A stale id (note deleted meanwhile) ends the drag silently.
    if (!moveObject(doc, note.id, p.x, p.y) && !hasObject(doc, note.id)) finish(false);
  };

  useEffect(
    () => () => {
      const g = gestureRef.current;
      if (g) cancelFrame(g);
      gestureRef.current = null;
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Never let a press on a note reach the board (no pan, no deselect).
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || editing || !editable) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Pointer already released; the gesture ends on pointerup as usual.
    }
    gestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: note.x,
      originY: note.y,
      zoom,
      dragging: false,
      pending: null,
      frame: null,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || e.pointerId !== g.pointerId) return;
    // The board was locked mid-gesture: stop without moving the note any further.
    if (!editable) {
      finish(false);
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!hasObject(doc, note.id)) {
        finish(false);
        return;
      }
      g.dragging = true;
      bringToFront(doc, note.id);
      setDragging(true);
    }
    g.pending = { x: g.originX + dx / g.zoom, y: g.originY + dy / g.zoom };
    if (g.frame === null) {
      g.frame = requestAnimationFrame(() => {
        g.frame = null;
        applyPending(g);
      });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const g = gestureRef.current;
    if (!g || e.pointerId !== g.pointerId) return;
    cancelFrame(g);
    applyPending(g);
    finish(true);
  };

  // Interrupted drag: keep the last position shown.
  const onPointerCancel = () => {
    const g = gestureRef.current;
    if (!g) return;
    g.pending = null;
    finish(g.dragging);
  };

  const endEdit = (next: 'selected' | 'unselected') => {
    props.onEndEdit(next);
    if (next === 'selected') noteRef.current?.focus({ preventScroll: true });
  };

  const showToolbar = editable && selected && !editing && !dragging;
  const invZoom = 1 / zoom;
  const style = {
    left: note.x,
    top: note.y,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    zIndex: props.layer,
    backgroundColor: STICKY_COLORS[note.color],
    '--note-fade': STICKY_COLORS[note.color],
    '--inv-zoom': invZoom,
  } as CSSProperties;

  const classes = ['sticky-note'];
  if (fit.overflow) classes.push('is-overflowing');
  if (dragging) classes.push('is-dragging');
  if (editing) classes.push('is-editing');

  return (
    <>
      <div
        ref={noteRef}
        className={classes.join(' ')}
        role="group"
        aria-label="Sticky note"
        tabIndex={0}
        data-sticky-id={note.id}
        data-selected={selected}
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (editable && hasObject(doc, note.id)) props.onStartEdit(note.id);
        }}
        onFocus={(e) => {
          // Keyboard focus (Tab) selects; a pointer press selects on release instead.
          if (editable && e.target === e.currentTarget && !gestureRef.current && !selected)
            props.onSelect(note.id);
        }}
      >
        <div className="sticky-body">
          <div ref={measureRef} className="sticky-measure" aria-hidden="true">
            {measurable(note.text)}
          </div>
          {editing && ytext ? (
            <StickyTextEditor
              ytext={ytext}
              fontPx={fit.fontPx}
              onEnd={endEdit}
              style={fit.overflow ? { height: '100%' } : { height: fit.textHeight || undefined }}
            />
          ) : (
            <div className="sticky-text" style={{ fontSize: `${fit.fontPx}px` }}>
              {note.text}
            </div>
          )}
        </div>
      </div>
      {showToolbar && (
        // Screen-sized (counter-scaled) and above every note.
        <div
          className="note-toolbar-anchor"
          style={{
            left: note.x + STICKY_SIZE_WORLD / 2,
            top: note.y,
            transform: `scale(${invZoom})`,
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c) => setStickyColor(doc, note.id, c)}
            onDelete={() => deleteObject(doc, note.id)}
          />
        </div>
      )}
    </>
  );
}
