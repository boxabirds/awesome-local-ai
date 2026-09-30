import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import {
  fitFontSize,
  stickyTextContentBox,
  STICKY_TEXT_PADDING_WORLD,
} from './StickyText';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom; the drag delta is divided by it so the grab point tracks. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Whether this note can be taken hold of at all: select, drag, edit, recolour,
   * delete. False is the board being out of reach — the note is still drawn, with
   * its text, because what is on the screen is what the board last said, and a
   * person reading it should not be shown a blank board (`persist.corrupt_snapshot`).
   */
  editable?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  moved: boolean;
}

const SELECTED_OUTLINE = '2px solid #2f6feb';

/**
 * One sticky note on the board: it renders the note text, handles select / drag
 * to move / double-click to edit, exposes the colour + delete toolbar, and
 * auto-fits its text. Its own pointer events stop propagation so the board
 * neither pans nor creates a note underneath. See design.md sticky.interaction.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  editable = true,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): ReactNode {
  const [dragging, setDragging] = useState(false);
  const [font, setFont] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ dx: number; dy: number } | null>(null);
  const zoomRef = useRef(zoom);
  const displayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Auto-fit the display text whenever it changes (not while editing).
  useLayoutEffect(() => {
    if (editing) return;
    const el = displayRef.current;
    if (!el) return;
    const result = fitFontSize(el, stickyTextContentBox());
    setFont((prev) => (prev === result.fontPx ? prev : result.fontPx));
    setOverflow((prev) => (prev === result.overflow ? prev : result.overflow));
  }, [note.text, editing]);

  const stopDrag = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    dragRef.current = null;
    setDragging(false);
  }, []);

  // Apply the newest pending delta at most once per animation frame.
  const flushMove = useCallback((): void => {
    rafRef.current = null;
    const drag = dragRef.current;
    const pending = pendingRef.current;
    if (!drag || !pending) return;
    pendingRef.current = null;
    const z = zoomRef.current;
    const nx = drag.origX + pending.dx / z;
    const ny = drag.origY + pending.dy / z;
    // A note removed mid-drag makes moveObject return false; end silently.
    if (!moveObject(doc, note.id, nx, ny)) stopDrag();
  }, [doc, note.id, stopDrag]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editable || editing || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Bringing the note to the front when it is picked (a press selects it) means
    // a selected, double-clicked or dragged note all end up on top.
    bringToFront(doc, note.id);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: note.x,
      origY: note.y,
      moved: false,
    };
    onSelect(note.id);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || editing || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragging(true);
    }
    pendingRef.current = { dx, dy };
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushMove);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    // Apply the last delta synchronously so the note stops under the pointer.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      flushMove();
    }
    stopDrag();
  };

  // A cancelled / interrupted drag keeps the last applied position.
  const onPointerEnd = (): void => {
    if (dragRef.current) stopDrag();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!editable) return;
    event.stopPropagation();
    if (!editing) onStartEdit(note.id);
  };

  // Cancel a queued frame on unmount.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  const noteStyle: CSSProperties = {
    position: 'absolute',
    left: note.x,
    top: note.y,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    backgroundColor: STICKY_COLORS[note.color],
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.20)',
    borderRadius: 2,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
    cursor: dragging ? 'grabbing' : 'grab',
    outline: selected ? SELECTED_OUTLINE : 'none',
    userSelect: editing ? 'text' : 'none',
    touchAction: 'none',
  };

  const textStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    padding: `${STICKY_TEXT_PADDING_WORLD}px`,
    boxSizing: 'border-box',
    color: '#1f2328',
    fontFamily: 'var(--vidi6-font)',
    lineHeight: 1.25,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
    textAlign: 'center',
    overflow: 'hidden',
    fontSize: `${font}px`,
  };

  return (
    <div
      data-testid="sticky-note"
      data-id={note.id}
      data-z={note.z}
      data-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      aria-roledescription={editable ? 'Sticky note' : 'Sticky note (read-only board)'}
      tabIndex={0}
      style={noteStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onDoubleClick={onDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={font} onEnd={onEndEdit} />
      ) : (
        <div
          ref={displayRef}
          data-testid="sticky-note-text"
          data-overflow={overflow ? 'true' : 'false'}
          className={
            overflow
              ? 'sticky-note__text sticky-note__text--overflow'
              : 'sticky-note__text'
          }
          style={textStyle}
        >
          {note.text}
        </div>
      )}

      {selected && !editing && !dragging && editable ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            marginBottom: 6,
            // Counter-scale so the toolbar renders at a constant screen size
            // (it sits inside the world layer, which the board scales by zoom).
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'left bottom',
            pointerEvents: 'auto',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color: StickyColor): void => {
              setStickyColor(doc, note.id, color);
            }}
            onDelete={(): void => {
              deleteObject(doc, note.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
