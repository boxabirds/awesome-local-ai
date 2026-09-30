import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { type StickySnapshot, bringToFront, getStickyText, moveObject } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import { STICKY_LINE_HEIGHT, STICKY_PADDING_WORLD, fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const PRIMARY_BUTTON = 0;
/** Selection outline width in screen pixels (divided by zoom inside the scaled world layer). */
const SELECTION_OUTLINE_PX = 2;
/** Height available to text inside a note, in board units. */
const TEXT_BOX_WORLD = STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD;

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  noteX: number;
  noteY: number;
  dragging: boolean;
  /** Last position written to the document during this drag. */
  applied: { x: number; y: number };
}

interface Fit {
  fontPx: number;
  overflow: boolean;
  /** Rendered text height in board units (capped at the text box). */
  textHeight: number;
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * One sticky note in the world layer: select, drag to move, double-click to edit.
 * Stacking uses `z-index: z` with the parent rendering notes in id order, so equal
 * z values tie-break by id and dragging never re-orders (and detaches) DOM nodes.
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
  /** Reports drag start/end so the floating note toolbar can hide while dragging. */
  onDragChange?(dragging: boolean): void;
}): React.JSX.Element {
  const { note, doc } = props;
  const id = note.id;
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<Fit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false, textHeight: 0 });
  const latest = useRef(props);
  latest.current = props;
  const ytext = useMemo(() => getStickyText(doc, id), [doc, id]);

  // Text fit: re-measured when the text changes (zoom scales everything uniformly).
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const result = fitFontSize(el, TEXT_BOX_WORLD);
    const textHeight = Math.min(el.scrollHeight, TEXT_BOX_WORLD);
    setFit((f) =>
      f.fontPx === result.fontPx && f.overflow === result.overflow && f.textHeight === textHeight
        ? f
        : { ...result, textHeight },
    );
  }, [note.text]);

  const exists = () => getStickyText(doc, id) !== undefined;

  const stopFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  /** Ends the press/drag. With `applyPending`, the latest pointer position is written first. */
  const endPress = (applyPending: boolean) => {
    const p = press.current;
    if (!p) return;
    stopFrame();
    if (applyPending) writePending();
    press.current = null;
    pending.current = null;
    if (p.dragging) {
      setDragging(false);
      latest.current.onDragChange?.(false);
    }
  };

  /** Writes the pending drag position. A rejected write for a deleted note ends the drag silently. */
  function writePending() {
    const p = press.current;
    const next = pending.current;
    pending.current = null;
    if (!p || !next || (next.x === p.applied.x && next.y === p.applied.y)) return;
    if (moveObject(doc, id, next.x, next.y)) p.applied = next;
    else if (!exists()) endPress(false);
  }

  useEffect(
    () => () => {
      stopFrame();
      if (press.current?.dragging) latest.current.onDragChange?.(false);
      press.current = null;
    },
    [],
  );

  // Keyboard users: focus the note again when editing ends with Escape.
  const wasEditing = useRef(props.editing);
  useEffect(() => {
    if (wasEditing.current && !props.editing && props.selected) rootRef.current?.focus({ preventScroll: true });
    wasEditing.current = props.editing;
  }, [props.editing, props.selected]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The board must never pan (or clear the selection) from a press on a note.
    e.stopPropagation();
    if (props.editing || e.button !== PRIMARY_BUTTON || press.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    press.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      noteX: note.x,
      noteY: note.y,
      dragging: false,
      applied: { x: note.x, y: note.y },
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!exists()) {
        endPress(false);
        return;
      }
      p.dragging = true;
      setDragging(true);
      latest.current.onDragChange?.(true);
      bringToFront(doc, id);
    }
    // Screen delta / zoom keeps the grabbed point under the pointer at any zoom.
    const zoom = latest.current.zoom;
    pending.current = { x: p.noteX + dx / zoom, y: p.noteY + dy / zoom };
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      writePending();
    });
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, applyPending: boolean) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    endPress(applyPending);
    if (exists()) latest.current.onSelect(id);
  };

  const classes = ['sticky-note'];
  if (props.selected) classes.push('is-selected');
  if (dragging) classes.push('is-dragging');
  if (fit.overflow) classes.push('sticky-note--overflow');
  const lineHeightWorld = fit.fontPx * STICKY_LINE_HEIGHT;
  const editorTop = STICKY_PADDING_WORLD + (TEXT_BOX_WORLD - Math.max(fit.textHeight, lineHeightWorld)) / 2;

  return (
    <div
      ref={rootRef}
      className={classes.join(' ')}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-sticky-note=""
      data-id={id}
      data-color={note.color}
      data-selected={props.selected ? 'true' : 'false'}
      data-editing={props.editing ? 'true' : 'false'}
      data-state={dragging ? 'dragging' : 'idle'}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        zIndex: note.z,
        backgroundColor: STICKY_COLORS[note.color],
        ['--sticky-color' as string]: STICKY_COLORS[note.color],
        outlineWidth: props.selected ? `${SELECTION_OUTLINE_PX / props.zoom}px` : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
      onLostPointerCapture={(e) => finish(e, false)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!props.editing) props.onStartEdit(id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget && !props.editing) {
          e.preventDefault();
          props.onStartEdit(id);
        }
      }}
      onFocus={(e) => {
        // Tab reaches a note and selects it; mouse focus selects on pointerup instead.
        if (e.target === e.currentTarget && !props.selected && isFocusVisible(e.currentTarget)) props.onSelect(id);
      }}
    >
      <div
        ref={contentRef}
        className="sticky-text"
        data-testid="sticky-text"
        style={{
          fontSize: `${fit.fontPx}px`,
          lineHeight: STICKY_LINE_HEIGHT,
          left: STICKY_PADDING_WORLD,
          right: STICKY_PADDING_WORLD,
          maxHeight: TEXT_BOX_WORLD,
          visibility: props.editing ? 'hidden' : undefined,
        }}
      >
        {note.text}
      </div>
      {props.editing && ytext && (
        <div className="sticky-editor-wrap" style={{ top: editorTop, bottom: STICKY_PADDING_WORLD }}>
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={props.onEndEdit} />
        </div>
      )}
    </div>
  );
}
