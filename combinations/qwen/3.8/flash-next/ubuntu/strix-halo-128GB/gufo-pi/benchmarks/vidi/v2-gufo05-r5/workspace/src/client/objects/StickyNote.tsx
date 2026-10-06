/**
 * A sticky note on the board: it renders the note, handles selecting and dragging it,
 * and hosts the text editor while it is being edited.
 *
 * Interaction states (per note, never stored in the document):
 * Unselected -> Pressed (pointerdown) -> Selected (pointerup within DRAG_THRESHOLD_PX)
 * or Dragging (moved further), Dragging -> Selected on release or cancel.
 * Selected -> Editing (double-click or Enter) -> Selected (Escape) / Unselected (click outside).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';
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
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import type { EndEditNext } from '../board/useSelection';
import { fitFontSize, STICKY_TEXT_BOX_WORLD } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Current board zoom, so a screen-space drag can be turned into world units. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Whether this note may be changed (story 4). False while the room could not load the board:
   * the note can still be selected and read, but it cannot be dragged, typed in, recoloured or
   * deleted.
   */
  canEdit?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

type InteractionState = 'idle' | 'pressed' | 'dragging';

interface Interaction {
  state: InteractionState;
  pointerId: number | null;
  id: string;
  /** Pointer position at pointerdown, in screen pixels. */
  startX: number;
  startY: number;
  /** Note position at pointerdown, in world units. */
  originX: number;
  originY: number;
  /** Latest pointer position, in screen pixels. */
  latestX: number;
  latestY: number;
  /** The pending animation frame that writes the position, or null. */
  frame: number | null;
}

const IDLE: Interaction = {
  state: 'idle',
  pointerId: null,
  id: '',
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
  latestX: 0,
  latestY: 0,
  frame: null,
};

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  canEdit = true,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  // the zoom and callbacks used by the drag loop must be current, not the ones the
  // frame was scheduled with
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // the drag loop writes positions from a scheduled frame, so it reads the current answer rather
  // than the one its callback was created with: a board that turns read-only halfway through a
  // drag leaves the note where it is
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const interaction = useRef<Interaction>({ ...IDLE });

  const ytext = useMemo(() => getStickyText(doc, note.id), [doc, note.id]);

  const clearFrame = useCallback(() => {
    const state = interaction.current;
    if (state.frame !== null) {
      cancelAnimationFrame(state.frame);
      state.frame = null;
    }
  }, []);

  /** Writes the note position that keeps the grabbed point under the pointer. */
  const applyPosition = useCallback((): boolean => {
    const state = interaction.current;
    if (state.state !== 'dragging') return true;
    if (!canEditRef.current) return true;
    const currentZoom = zoomRef.current > 0 ? zoomRef.current : 1;
    const x = state.originX + (state.latestX - state.startX) / currentZoom;
    const y = state.originY + (state.latestY - state.startY) / currentZoom;
    return moveObject(doc, state.id, x, y);
  }, [doc]);

  /** Leaves Pressed/Dragging. `flush` writes the last pointer position (a real release). */
  const finishInteraction = useCallback(
    (flush: boolean) => {
      const state = interaction.current;
      if (state.state === 'idle') return;
      const wasDragging = state.state === 'dragging';
      const id = state.id;
      interaction.current = { ...IDLE };
      clearFrame();
      if (flush && wasDragging && !applyPosition()) return; // the note is gone: stay quiet
      if (wasDragging) setDragging(false);
      onSelect(id);
    },
    [applyPosition, clearFrame, onSelect],
  );

  // The note can disappear while it is being dragged (story 3, or the bin button):
  // the interaction ends silently instead of throwing.
  useEffect(() => {
    if (interaction.current.state !== 'idle') clearFrame();
    interaction.current = { ...IDLE };
    setDragging(false);
  }, [note.id, clearFrame]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // the note toolbar handles its own clicks
    if (target?.closest('[data-note-toolbar]')) return;
    // panning the board starts on empty space only: a note never pans the board
    event.stopPropagation();
    if (editing) return; // typing (and selecting text) is the textarea's business
    if (!canEdit) {
      // selecting a note is not changing it, so this still happens; what does not happen is the
      // press that would turn into a drag (story 4)
      onSelect(note.id);
      return;
    }

    const element = ref.current;
    element?.setPointerCapture?.(event.pointerId);
    interaction.current = {
      state: 'pressed',
      pointerId: event.pointerId,
      id: note.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: note.x,
      originY: note.y,
      latestX: event.clientX,
      latestY: event.clientY,
      frame: null,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = interaction.current;
    if (state.state === 'idle' || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;

    if (state.state === 'pressed') {
      // a short press without movement selects; moving to the threshold starts a drag
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      state.state = 'dragging';
      setDragging(true);
      bringToFront(doc, state.id); // the dragged note is drawn above the others
    }

    state.latestX = event.clientX;
    state.latestY = event.clientY;
    if (state.frame === null) {
      state.frame = requestAnimationFrame(() => {
        state.frame = null;
        if (!applyPosition()) finishInteraction(false);
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = interaction.current;
    if (state.state === 'idle' || state.pointerId !== event.pointerId) return;
    finishInteraction(true);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = interaction.current;
    if (state.state === 'idle' || state.pointerId !== event.pointerId) return;
    finishInteraction(false); // the note stays where it was last shown
  };

  // A drag is also what raises the note above the others, and the render order follows `z`, so
  // starting one moves the note's own DOM node - and a node taken out of the tree and put back
  // loses pointer capture. With the button still under it that is the same drag, so the capture is
  // simply taken back; without this, dragging any note that was not already drawn on top would
  // end before the pointer had gone anywhere.
  const onLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = interaction.current;
    if (state.state !== 'idle' && state.pointerId === event.pointerId && event.buttons !== 0) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    finishInteraction(false); // the note stays where it was last shown
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // the board must not create a second note underneath this one
    event.stopPropagation();
    event.preventDefault();
    if (editing) return;
    onSelect(note.id);
    // no editing on a board that could not be loaded (story 4)
    if (!canEdit) return;
    onStartEdit(note.id);
  };

  // ---- auto-fit: the largest size at which the text still fits (world units, so it
  // scales with zoom and never needs re-measuring when the zoom changes) ----
  useLayoutEffect(() => {
    if (editing) return;
    const element = textRef.current;
    if (!element) return;
    const fit = fitFontSize(element, STICKY_TEXT_BOX_WORLD);
    setFontPx((previous) => (previous === fit.fontPx ? previous : fit.fontPx));
    setOverflow((previous) => (previous === fit.overflow ? previous : fit.overflow));
  }, [note.text, editing]);

  const style = {
    left: note.x,
    top: note.y,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    background: STICKY_COLORS[note.color],
    zIndex: note.z,
    '--note-padding': `${STICKY_PADDING_WORLD}px`,
    '--note-inverse-zoom': zoom > 0 ? String(1 / zoom) : '1',
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className="sticky-note"
      data-board-object
      data-sticky-note
      data-note-id={note.id}
      data-selected={selected ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      data-overflow={overflow ? 'true' : undefined}
      data-testid="sticky-note"
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      ) : (
        <>
          <div
            ref={textRef}
            className="sticky-note__text"
            data-testid="sticky-note-text"
            style={{ fontSize: `${fontPx}px` }}
          >
            {note.text}
          </div>
          {overflow ? (
            <div className="sticky-note__fade" data-testid="note-fade" aria-hidden="true" />
          ) : null}
        </>
      )}
      {selected && !editing && !dragging ? (
        <NoteToolbar
          color={note.color}
          canEdit={canEdit}
          onColor={(color: StickyColor) => {
            if (!canEdit) return;
            setStickyColor(doc, note.id, color); // text, position and selection untouched
          }}
          onDelete={() => {
            if (!canEdit) return;
            deleteObject(doc, note.id);
            onEndEdit('unselected');
          }}
        />
      ) : null}
    </div>
  );
}
