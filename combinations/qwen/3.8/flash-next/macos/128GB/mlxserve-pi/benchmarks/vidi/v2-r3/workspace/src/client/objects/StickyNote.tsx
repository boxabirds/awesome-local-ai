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
  deleteObject,
  getStickyText,
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
  /** False only while the board cannot be edited. */
  canEdit?: boolean;
  onSelect(id: string): void;
  /** Shift+click toggles the note in/out of the selection. */
  onToggle?(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
  /** Transform gesture handlers: called for pointer events on this note. */
  onGesturePointerDown?(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  onGesturePointerMove?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerUp?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerCancel?(e: ReactPointerEvent<HTMLDivElement>): void;
}

/**
 * One sticky note: a square of colour in the world layer that can be
 * selected, dragged, recoloured, typed into and deleted.
 *
 * The drag gesture is delegated to the transform gesture (story 7); this
 * component only handles selection, editing, colour and deletion.
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

  const gestureActiveRef = useRef(false);

  useLayoutEffect(() => {
    propsRef.current = props;
  });

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
    // Shift+click toggles selection without starting a drag.
    if (e.shiftKey) {
      if (propsRef.current.onToggle) propsRef.current.onToggle(note.id);
      return;
    }

    // Delegate to the transform gesture.
    setPressed(true);
    gestureActiveRef.current = true;
    startXYRef.current = { x: e.clientX, y: e.clientY };
    if (propsRef.current.onGesturePointerDown) {
      propsRef.current.onGesturePointerDown(e, note.id);
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
  };

  const startXYRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!gestureActiveRef.current) return;
    e.stopPropagation();
    if (propsRef.current.onGesturePointerMove) {
      propsRef.current.onGesturePointerMove(e);
    }
    // Detect dragging only past the threshold.
    if (!dragging && startXYRef.current !== null) {
      const dx = e.clientX - startXYRef.current.x;
      const dy = e.clientY - startXYRef.current.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        setDragging(true);
      }
    }
  };

  const endPress = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!gestureActiveRef.current) return;
    e.stopPropagation();
    gestureActiveRef.current = false;
    setPressed(false);
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    // Forward to gesture
    if (e.type === 'pointerup' && propsRef.current.onGesturePointerUp) {
      propsRef.current.onGesturePointerUp(e);
    } else if (e.type !== 'pointerup' && propsRef.current.onGesturePointerCancel) {
      propsRef.current.onGesturePointerCancel(e);
    }
    // Select the note on click (not drag)
    propsRef.current.onSelect(note.id);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Editing this note; the viewport must not create another one here.
    e.stopPropagation();
    if (propsRef.current.canEdit === false) return;
    propsRef.current.onStartEdit(note.id);
  };

  const onColor = (color: StickyColor) => {
    if (propsRef.current.canEdit === false) return;
    setStickyColor(doc, note.id, color);
  };

  const onDelete = () => {
    if (propsRef.current.canEdit === false) return;
    deleteObject(doc, note.id);
  };

  const ytext = getStickyText(doc, note.id);
  const state = editing ? 'editing' : dragging ? 'dragging' : pressed ? 'pressed' : selected ? 'selected' : 'unselected';
  const noteWidth = note.width ?? STICKY_SIZE_WORLD;
  const noteHeight = note.height ?? STICKY_SIZE_WORLD;
  const style = {
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${noteWidth}px`,
    height: `${noteHeight}px`,
    backgroundColor: STICKY_COLORS[note.color],
    fontSize: `${fit.fontPx}px`,
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
