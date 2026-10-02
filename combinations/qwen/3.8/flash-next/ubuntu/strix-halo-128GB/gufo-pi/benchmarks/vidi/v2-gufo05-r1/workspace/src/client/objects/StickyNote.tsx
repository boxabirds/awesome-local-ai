/**
 * One sticky note on the board.
 *
 * It renders a note from the document snapshot and owns the per-person
 * interaction with it (the state machine in the story's design):
 *
 *   Unselected ──pointerdown──▶ Pressed ──pointerup──▶ Selected
 *                                   └─move ≥ DRAG_THRESHOLD_PX─▶ Dragging
 *   Selected ──dblclick / Enter──▶ Editing ──Escape──▶ Selected
 *
 * Selection and editing come in as props, so `App` holds the single "what is
 * selected" answer for the whole board. Every pointer interaction stops
 * propagation: grabbing a note moves the note, never the board.
 *
 * Positions and sizes are world units; the world layer scales them, which is
 * why dragging divides the pointer delta by the camera zoom.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
  note: StickySnapshot;
  doc: Y.Doc;
  /** Current camera zoom, so screen pointer deltas convert to world units. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

/** Local interaction phase of the pointer on this note. */
type PressPhase = 'idle' | 'pressed' | 'dragging';

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [fontPx, setFontPx] = useState<number | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [phase, setPhase] = useState<PressPhase>('idle');
  const phaseRef = useRef<PressPhase>('idle');
  const setPressPhase = useCallback((next: PressPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /** Latest values the drag needs without restarting on every render. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const dragRef = useRef<{
    pointerId: number;
    fromX: number;
    fromY: number;
    noteX: number;
    noteY: number;
    toX: number;
    toY: number;
    frame: number | null;
  } | null>(null);

  // Text auto-fit: measured on the displayed text, never on zoom (the world
  // layer scales the note uniformly).
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || editing) return;
    const fitted = fitFontSize(element, element.clientHeight);
    setFontPx(fitted.fontPx);
    setOverflow(fitted.overflow);
  }, [editing, note.text]);

  const stopDrag = useCallback(() => {
    const frame = dragRef.current?.frame;
    if (frame !== null && frame !== undefined) cancelAnimationFrame(frame);
    dragRef.current = null;
    setPressPhase('idle');
  }, [setPressPhase]);

  // A note removed from the document mid-drag simply stops interacting: the
  // component is about to unmount and nothing is written back.
  useEffect(() => stopDrag, [stopDrag]);

  const writePosition = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const scale = zoomRef.current || 1;
    const applied = moveObject(
      doc,
      note.id,
      drag.noteX + (drag.toX - drag.fromX) / scale,
      drag.noteY + (drag.toY - drag.fromY) / scale,
    );
    if (!applied) stopDrag(); // the note is gone (stale id): end silently
  }, [doc, note.id, stopDrag]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Never let this reach the viewport: dragging a note must not pan the board.
    event.stopPropagation();
    if (editing) return; // clicks inside the editor place the caret
    const element = elementRef.current;
    try {
      element?.setPointerCapture?.(event.pointerId);
    } catch {
      // Best effort: events on the note itself still drive the drag.
    }
    setPressPhase('pressed');
    dragRef.current = {
      pointerId: event.pointerId,
      fromX: event.clientX,
      fromY: event.clientY,
      noteX: note.x,
      noteY: note.y,
      toX: event.clientX,
      toY: event.clientY,
      frame: null,
    };
  };

  /*
   * The press is followed on `window` for as long as it lasts, not on the note
   * element the press started on. Two reasons:
   *
   * - Bringing the note to the front puts its DOM node last among its siblings,
   *   and the browser drops pointer capture when a node is moved in the tree.
   *   Listeners that live above the tree survive the raise.
   * - The pointer regularly leaves the note mid-drag, and may pass over another
   *   note or leave the board entirely.
   */
  useEffect(() => {
    if (phase === 'idle') return;

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.toX = event.clientX;
      drag.toY = event.clientY;
      const distance = Math.hypot(drag.toX - drag.fromX, drag.toY - drag.fromY);

      if (phaseRef.current === 'pressed' && distance >= DRAG_THRESHOLD_PX) {
        // One raise at the start of the drag, then the note follows the pointer.
        setPressPhase('dragging');
        bringToFront(doc, note.id);
      }
      if (phaseRef.current !== 'dragging') return;
      if (drag.frame !== null) return; // one write per animation frame
      if (typeof requestAnimationFrame === 'function') {
        drag.frame = requestAnimationFrame(() => {
          if (dragRef.current) dragRef.current.frame = null;
          writePosition();
        });
      } else {
        writePosition(); // jsdom and hidden tabs
      }
    };

    const finish = (event: PointerEvent, cancelled: boolean) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      // A drag ends exactly under the pointer; an interrupted one keeps the
      // position it was last shown at.
      if (phaseRef.current === 'dragging' && !cancelled) writePosition();
      try {
        elementRef.current?.releasePointerCapture?.(event.pointerId);
      } catch {
        // Ignored: capture may already be gone.
      }
      stopDrag();
      onSelect(note.id);
    };

    const onUp = (event: PointerEvent) => finish(event, false);
    const onCancel = (event: PointerEvent) => finish(event, true);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [phase, doc, note.id, onSelect, stopDrag, writePosition]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={elementRef}
      data-sticky-note
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-color={note.color}
      data-note-x={note.x}
      data-note-y={note.y}
      data-note-z={note.z}
      data-text-length={note.text.length}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      className={[
        'sticky-note',
        selected ? 'sticky-note--selected' : '',
        overflow ? 'sticky-note--overflow' : '',
        phase === 'dragging' ? 'sticky-note--dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: STICKY_COLORS[note.color],
        zIndex: note.z,
      }}
      onPointerDown={handlePointerDown}
      onContextMenu={(event) => {
        // Long-press on a touch device selects the note instead of opening the
        // browser's own menu.
        event.preventDefault();
        if (!editing) onSelect(note.id);
      }}
      onFocus={() => {
        if (!editing) onSelect(note.id);
      }}
      onDoubleClick={(event) => {
        // A double-click on a note edits it; it must never create another one.
        event.stopPropagation();
        if (!editing) onStartEdit(note.id);
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx ?? STICKY_FONT_MAX_PX}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          ref={textRef}
          className="sticky-note__text"
          data-testid="sticky-note-text"
          style={fontPx ? { fontSize: `${fontPx}px` } : undefined}
        >
          {note.text}
        </div>
      )}
      {overflow && !editing ? (
        <div className="sticky-note__fade" data-testid="sticky-note-fade" aria-hidden="true" />
      ) : null}
      {selected && !editing && phase !== 'dragging' ? (
        <div
          className="sticky-note__toolbar-anchor"
          style={{ transform: `scale(${1 / (zoom || 1)})` }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color: StickyColor) => {
              setStickyColor(doc, note.id, color);
            }}
            onDelete={() => {
              deleteObject(doc, note.id);
              // The note is gone, so nothing is selected or edited any more.
              onEndEdit('unselected');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
