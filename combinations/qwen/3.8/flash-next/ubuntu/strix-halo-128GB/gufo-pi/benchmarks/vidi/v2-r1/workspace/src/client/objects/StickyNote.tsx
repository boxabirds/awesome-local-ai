import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
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
import { fitFontSize } from './StickyText';
import { STICKY_TEXT_BOX_WORLD, StickyTextEditor } from './StickyTextEditor';

export interface StickyNoteProps {
  /** Plain data for this note, from the board snapshot. */
  note: StickySnapshot;
  /** The shared document the mutations are applied to. */
  doc: Y.Doc;
  /** Camera zoom, screen pixels per world unit. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/**
 * Where a note is with the pointer: nothing, a press that has not moved enough
 * to be a drag, or a drag. Selection and text editing are separate (local
 * selection state), so "pressed" and "dragging" only exist here.
 */
type Phase = 'idle' | 'pressed' | 'dragging';

interface DragState {
  pointerId: number;
  /** Pointer position at press, in screen pixels. */
  startClientX: number;
  startClientY: number;
  /** Note top-left at press, in world units. */
  originX: number;
  originY: number;
  /** Set once the pointer has travelled `DRAG_THRESHOLD_PX`. */
  dragging: boolean;
  /** Position to write on the next animation frame. */
  pending: { x: number; y: number } | null;
  frame: number | null;
}

/**
 * One sticky note on the board.
 *
 * It is a square of colour in the world layer, so it pans and zooms with
 * everything else. A press selects it, travel beyond `DRAG_THRESHOLD_PX` drags
 * it (and brings it to the front), a double-click edits its text, and the
 * toolbar of the selected note floats above it in screen space so the buttons
 * stay the same size at any zoom.
 *
 * A press never reaches the viewport: dragging a note must not pan the board,
 * and releasing on a note must not clear the selection.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): JSX.Element {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  // Latest values for handlers and frames that outlive the render they came from.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;

  /** Fit the display text to the note (measurement, so after layout). */
  useLayoutEffect(() => {
    if (editing) return;
    const element = textRef.current;
    if (!element) return;
    const fit = fitFontSize(element, STICKY_TEXT_BOX_WORLD);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [note.text, editing]);

  /** Apply the position the pointer reached, if a frame has not done it yet. */
  const applyPendingMove = useCallback((): boolean => {
    const drag = dragRef.current;
    if (!drag) return true;
    if (drag.frame !== null) {
      cancelFrame(drag.frame);
      drag.frame = null;
    }
    const target = drag.pending;
    if (target === null) return true;
    drag.pending = null;
    // false means the note is gone (deleted by somebody else): the drag ends
    // quietly instead of resurrecting it.
    return moveObject(doc, note.id, target.x, target.y);
  }, [doc, note.id]);

  const endDrag = useCallback((): void => {
    const stillThere = applyPendingMove();
    dragRef.current = null;
    setPhase((current) => (current === 'idle' ? current : 'idle'));
    if (stillThere) onSelect(note.id);
  }, [applyPendingMove, note.id, onSelect]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // The board must neither pan nor lose the selection because of a press on a
    // note - that is what makes `sticky.no_pan` true.
    event.stopPropagation();
    if (editing) return; // clicks inside an editing note move the caret
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const element = elementRef.current;
    try {
      element?.setPointerCapture(event.pointerId);
    } catch {
      // No pointer capture (jsdom, or a pointer that is already gone): the
      // pointer events still arrive as long as they are delivered to the note.
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: note.x,
      originY: note.y,
      dragging: false,
      pending: null,
      frame: null,
    };
    setPhase('pressed');
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();

    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.dragging) {
      // A short press without travel is a click; only real movement drags.
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      // Once, at the start of the drag: the note comes above anything it overlaps.
      bringToFront(doc, note.id);
      setPhase('dragging');
    }

    const zoomNow = zoomRef.current || 1;
    drag.pending = { x: drag.originX + dx / zoomNow, y: drag.originY + dy / zoomNow };
    if (drag.frame === null) {
      drag.frame = requestFrame(() => {
        const current = dragRef.current;
        if (current === null) return;
        current.frame = null;
        if (!applyPendingMove()) {
          // The note disappeared mid-drag: stop, and drop the selection.
          dragRef.current = null;
          setPhase('idle');
          onEndEditRef.current('unselected');
        }
      });
    }
  };

  /**
   * pointerup, pointercancel and lostpointercapture all end the drag the same
   * way, leaving the note where it was last shown.
   */
  const handleDragEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    endDrag();
  };

  const handleDoubleClick = (
    event: ReactMouseEvent<HTMLDivElement> | ReactPointerEvent<HTMLDivElement>,
  ): void => {
    // A double-click on a note edits it; it must not create another note.
    event.stopPropagation();
    if (editing) return;
    onStartEdit(note.id);
  };

  // A press outside the note ends editing and drops the selection (the caret is
  // not outside the note, so this cannot steal it while typing).
  useEffect(() => {
    if (!editing) return undefined;
    const handleDocumentPointerDown = (event: PointerEvent): void => {
      const element = elementRef.current;
      if (
        element !== null &&
        event.target instanceof Node &&
        element.contains(event.target)
      ) {
        return;
      }
      onEndEditRef.current('unselected');
    };
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  }, [editing]);

  // A drag must not outlive the note: if the note is deleted from the document
  // while it is being dragged, stop quietly.
  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (drag !== null && drag.frame !== null) cancelFrame(drag.frame);
      dragRef.current = null;
    },
    [note.id],
  );

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={elementRef}
      className="sticky-note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-color={note.color}
      data-note-color={note.color}
      data-note-x={note.x}
      data-note-y={note.y}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={phase === 'dragging' ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[note.color],
        zIndex: note.z,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
      onLostPointerCapture={handleDragEnd}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext !== undefined ? (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textRef}
          className="sticky-note__text"
          data-testid="sticky-text"
          data-overflow={overflow ? 'true' : 'false'}
          style={{ fontSize: `${fontPx}px` }}
        >
          {note.text}
        </div>
      )}
      {overflow && !editing ? (
        <div
          className="sticky-note__fade"
          data-testid="sticky-fade"
          aria-hidden="true"
          style={{
            background: `linear-gradient(to bottom, transparent 0%, ${STICKY_COLORS[note.color]} 85%)`,
          }}
        />
      ) : null}

      {selected && !editing && phase !== 'dragging' ? (
        <div
          className="sticky-note__toolbar-anchor"
          data-testid="note-toolbar-anchor"
          // Counter-scaled so the toolbar stays the same size on screen at any
          // zoom instead of growing and shrinking with the note.
          style={{ transform: `scale(${1 / (zoom || 1)})` }}
        >
          <NoteToolbar
            color={note.color}
            // Only the colour changes: the note keeps its text, position and
            // selection, so the toolbar stays open on the recoloured note.
            onColor={(color: StickyColor) => setStickyColor(doc, note.id, color)}
            onDelete={() => {
              deleteObject(doc, note.id);
              onEndEdit('unselected');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

// ---- animation frame scheduling (with a fallback for bare jsdom) ----

const HAS_ANIMATION_FRAME =
  typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';

function requestFrame(callback: () => void): number {
  if (HAS_ANIMATION_FRAME) return window.requestAnimationFrame(() => callback());
  return window.setTimeout(callback, 0) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (HAS_ANIMATION_FRAME) window.cancelAnimationFrame(handle);
  else window.clearTimeout(handle as unknown as number);
}
