/**
 * One sticky note on the board: rendering plus the per-note interaction state
 * machine (Unselected -> Pressed -> Selected / Dragging / Editing).
 *
 * All geometry lives in world units inside the viewport's world layer; the drag
 * delta is converted to world units by dividing by the camera zoom, so the point
 * grabbed stays under the pointer at any zoom. `stopPropagation` on pointerdown
 * guarantees dragging a note never pans the board.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Doc, Text as YText } from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import {
  bringToFront,
  getStickyText,
  moveObject,
  setStickyColor,
  deleteObject,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onDeleted(id: string): void;
}

/** Inner padding around the note text, in world units. */
const NOTE_PADDING_WORLD = 12;

type DragPhase = 'idle' | 'pressed' | 'dragging';

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<DragPhase>('idle');
  const [fontPx, setFontPx] = useState<number>(0);
  const [overflow, setOverflow] = useState(false);

  // --- text auto-fit (mount + text change only; zoom scales uniformly) --------
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const fit = fitFontSize(el);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [note.text]);

  // --- drag -------------------------------------------------------------------
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    latestX: number;
    latestY: number;
    frame: number | null;
  } | null>(null);

  const endDragInteraction = useCallback((): void => {
    const drag = dragRef.current;
    if (drag && drag.frame !== null) cancelAnimationFrame(drag.frame);
    dragRef.current = null;
    setPhase('idle');
  }, []);

  // The note may disappear mid-drag (deleted elsewhere): end silently.
  useEffect(() => {
    return () => endDragInteraction();
  }, [endDragInteraction]);

  const applyMove = useCallback((): void => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = null;
    const worldX = drag.originX + (drag.latestX - drag.startClientX) / zoom;
    const worldY = drag.originY + (drag.latestY - drag.startClientY) / zoom;
    // A note deleted underneath the drag ends the interaction without an error.
    if (!moveObject(doc, note.id, worldX, worldY)) endDragInteraction();
  }, [doc, note.id, zoom, endDragInteraction]);

  const scheduleMove = useCallback((): void => {
    const drag = dragRef.current;
    if (!drag || drag.frame !== null) return;
    drag.frame = requestAnimationFrame(applyMove);
  }, [applyMove]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // The viewport must never pan or clear selection from a note interaction.
    event.stopPropagation();
    if (editing) return; // the textarea handles its own pointer events
    if (event.button !== 0) return;
    event.preventDefault();
    rootRef.current?.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: note.x,
      originY: note.y,
      latestX: event.clientX,
      latestY: event.clientY,
      frame: null,
    };
    setPhase('pressed');
    onSelect(note.id);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.latestX = event.clientX;
    drag.latestY = event.clientY;
    if (phase === 'pressed') {
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      setPhase('dragging');
      bringToFront(doc, note.id);
    }
    scheduleMove();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Apply the final position before releasing (the last move may be queued).
    if (drag.frame !== null) {
      cancelAnimationFrame(drag.frame);
      drag.frame = null;
      applyMove();
    }
    endDragInteraction(); // Pressed / Dragging -> Selected
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // The note stays where it was last shown.
    if (drag.frame !== null) {
      cancelAnimationFrame(drag.frame);
      drag.frame = null;
      applyMove();
    }
    endDragInteraction();
  };

  const onDoubleClick = (event: ReactMouseEvent): void => {
    // Never bubbles to the viewport (which would create a second note).
    event.stopPropagation();
    event.preventDefault();
    if (!editing) onStartEdit(note.id);
  };

  // --- end editing on a pointerdown outside the note --------------------------
  useEffect(() => {
    if (!editing) return;
    const onWindowPointerDown = (event: globalThis.PointerEvent): void => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        onEndEdit('unselected');
      }
    };
    window.addEventListener('pointerdown', onWindowPointerDown, true);
    return () => window.removeEventListener('pointerdown', onWindowPointerDown, true);
  }, [editing, onEndEdit]);

  const ytext: YText | undefined = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={rootRef}
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}${
        overflow ? ' sticky-note--overflow' : ''
      }`}
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: STICKY_COLORS[note.color],
        zIndex: note.z,
        cursor: phase === 'dragging' ? 'grabbing' : 'grab',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={textRef}
        className="sticky-note-text"
        data-testid="sticky-note-text"
        aria-hidden={editing ? 'true' : undefined}
        style={{
          padding: NOTE_PADDING_WORLD,
          fontSize: fontPx ? `${fontPx}px` : undefined,
          visibility: editing ? 'hidden' : 'visible',
        }}
      >
        {note.text}
      </div>
      {editing && ytext && (
        <StickyTextEditor
          key={note.id}
          ytext={ytext}
          fontPx={fontPx}
          onEnd={onEndEdit}
        />
      )}
      {overflow && <div className="sticky-note-fade" data-testid="sticky-note-fade" />}
      {selected && phase !== 'dragging' && !editing && (
        <div
          className="note-toolbar-anchor"
          style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'bottom left' }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color: StickyColor) => setStickyColor(doc, note.id, color)}
            onDelete={() => {
              if (deleteObject(doc, note.id)) props.onDeleted(note.id);
            }}
          />
        </div>
      )}
    </div>
  );
}
