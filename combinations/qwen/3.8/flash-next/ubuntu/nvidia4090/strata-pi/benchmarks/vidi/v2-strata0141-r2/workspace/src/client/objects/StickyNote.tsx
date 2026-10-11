import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_PADDING_WORLD,
  type StickyColor,
} from '../../shared/config';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize, type FontFit } from './StickyText';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import type { EndEditNext } from '../board/useSelection';

/**
 * One sticky note: rendered in the world layer at its document position, and
 * the owner of its own pointer interaction (press, drag, double-click).
 *
 * Selection and editing are held by `App`/`useSelection`; the drag itself is
 * local so a drag never writes anything the other client has to wait for.
 */

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, so screen pixels and world units stay in step while dragging. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

interface DragState {
  pointerId: number;
  id: string;
  /** Pointer position when the note was pressed (screen px). */
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  /** Note top-left when the drag began (world units). */
  originX: number;
  originY: number;
  dragging: boolean;
  frame: number | null;
}

const TEXT_BOX = STICKY_SIZE_WORLD - 2 * STICKY_TEXT_PADDING_WORLD;

function noteExists(doc: Y.Doc, id: string): boolean {
  const note = doc.getMap<Y.Map<unknown>>('objects').get(id);
  return note != null && note.get('type') === 'sticky';
}

function elementOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

/** Note tools are buttons, not part of the drag surface. */
function isToolbarTarget(target: EventTarget | null): boolean {
  return elementOf(target)?.closest('.note-toolbar') != null;
}

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const docRef = useRef(doc);
  docRef.current = doc;
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;

  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<FontFit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // Text fit: measure, never guess. Runs on mount and whenever the text changes;
  // zoom scales the whole world layer, so one measurement covers every zoom.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) {
      return;
    }
    const next = fitFontSize(el, TEXT_BOX);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [note.text]);

  // A cancelled or interrupted drag must not leave a frame behind.
  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (drag && drag.frame !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(drag.frame);
        } else {
          clearTimeout(drag.frame);
        }
        drag.frame = null;
      }
    },
    [],
  );

  // Edit end by clicking outside the note (Escape is handled by the editor).
  useEffect(() => {
    if (!editing) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      const target = event.target;
      if (root && target instanceof Node && root.contains(target)) {
        return;
      }
      onEndEditRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [editing]);

  const cancelFrame = (drag: DragState): void => {
    if (drag.frame !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(drag.frame);
      } else {
        clearTimeout(drag.frame);
      }
      drag.frame = null;
    }
  };

  /** Write the newest pointer offset into the document (screen px / zoom). */
  const applyMove = (drag: DragState): void => {
    drag.frame = null;
    const current = docRef.current;
    const zoomNow = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1;
    const x = drag.originX + (drag.lastClientX - drag.startClientX) / zoomNow;
    const y = drag.originY + (drag.lastClientY - drag.startClientY) / zoomNow;
    moveObject(current, drag.id, x, y);
    if (!noteExists(current, drag.id)) {
      // The note disappeared mid-drag (another client deleted it in story 3):
      // end quietly instead of recreating it.
      cancelFrame(drag);
      dragRef.current = null;
      setDragging(false);
    }
  };

  const scheduleMove = (drag: DragState): void => {
    if (drag.frame !== null) {
      return;
    }
    if (typeof requestAnimationFrame === 'function') {
      drag.frame = requestAnimationFrame(() => applyMove(drag));
    } else {
      drag.frame = setTimeout(() => applyMove(drag), 16) as unknown as number;
    }
  };

  const capturePointer = (el: HTMLElement, pointerId: number): void => {
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // Capture is an optimisation; dragging works without it.
      }
    }
  };

  const releasePointer = (el: HTMLElement, pointerId: number): void => {
    if (typeof el.releasePointerCapture === 'function' && el.hasPointerCapture?.(pointerId)) {
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        // Already released by the browser.
      }
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // A note owns its pointer: the board must neither pan nor create a note.
    event.stopPropagation();
    if (event.button !== 0 || editing || isToolbarTarget(event.target) || dragRef.current) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      id: note.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      originX: note.x,
      originY: note.y,
      dragging: false,
      frame: null,
    };
    capturePointer(event.currentTarget, event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.stopPropagation();
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;

    if (!drag.dragging) {
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return; // a short press is a selection, not a move
      }
      drag.dragging = true;
      setDragging(true);
      bringToFront(doc, drag.id); // once, so the note is above what it overlaps
    }

    scheduleMove(drag);
  };

  const finishDrag = (drag: DragState, flush: boolean): void => {
    if (flush && drag.dragging) {
      cancelFrame(drag);
      applyMove(drag);
    } else {
      cancelFrame(drag); // keep the last position already written to the doc
    }
    dragRef.current = null;
    if (drag.dragging) {
      setDragging(false);
    }
    if (noteExists(docRef.current, drag.id)) {
      onSelect(drag.id);
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.stopPropagation();
    releasePointer(event.currentTarget, event.pointerId);
    finishDrag(drag, true);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    // An interrupted drag leaves the note where it was last shown.
    finishDrag(drag, false);
  };

  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    // bringToFront() can move this note to the top of the stack, and a node that
    // is re-inserted into the document loses its pointer capture. The drag is
    // still live, so capture is taken again on the same node and the note keeps
    // following the pointer. A capture the browser drops for real (pointer gone,
    // node removed) still ends the drag, keeping the last applied position.
    const el = rootRef.current;
    if (drag.dragging && el !== null && el.isConnected && typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(event.pointerId);
        return;
      } catch {
        // Capture refused: fall through and finish the drag where it stands.
      }
    }
    finishDrag(drag, false);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Double-clicking a note edits it; it must never create another note.
    event.stopPropagation();
    if (!editing) {
      onStartEdit(note.id);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (editing) {
      return; // the textarea owns the keys while editing
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      onStartEdit(note.id);
    }
  };

  const changeColor = (color: StickyColor): void => {
    // Only the colour changes; text, position, stacking and selection stay put.
    setStickyColor(doc, note.id, color);
  };

  const remove = (): void => {
    deleteObject(doc, note.id);
    onEndEdit('unselected');
  };

  const showToolbar = selected && !dragging && !editing;
  const textClass = fit.overflow ? 'sticky-text sticky-text--fade' : 'sticky-text';
  const inverseZoom = Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1;
  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={rootRef}
      className="sticky-note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-color={note.color}
      data-z={note.z}
      data-overflow={fit.overflow ? 'true' : 'false'}
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
        '--sticky-text-padding': `${STICKY_TEXT_PADDING_WORLD}px`,
      } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className={textClass}
        data-testid="sticky-text"
        style={{ fontSize: `${fit.fontPx}px` }}
      >
        {note.text}
      </div>
      <div
        ref={measureRef}
        className="sticky-measure"
        data-testid="sticky-measure"
        aria-hidden="true"
        style={{ width: TEXT_BOX, fontSize: `${fit.fontPx}px` }}
      >
        {note.text}
      </div>
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : null}
      {showToolbar ? (
        <div
          className="note-toolbar-anchor"
          data-testid="note-toolbar-anchor"
          style={{ transform: `scale(${inverseZoom})` }}
        >
          <NoteToolbar color={note.color} onColor={changeColor} onDelete={remove} />
        </div>
      ) : null}
    </div>
  );
}
