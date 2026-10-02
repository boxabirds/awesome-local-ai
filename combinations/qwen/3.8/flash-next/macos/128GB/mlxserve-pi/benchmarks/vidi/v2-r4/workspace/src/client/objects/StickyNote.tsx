import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
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
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';

/** Space between the note edge and its text, in world units. */
const TEXT_INSET_WORLD = 12;
/** The box the text may fill; the font fit and the fade are measured against it. */
const TEXT_BOX_WORLD = STICKY_SIZE_WORLD - TEXT_INSET_WORLD * 2;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** One sticky note: text, drag, colours, delete (`sticky.*`). */
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
  const elRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // --- drag state -----------------------------------------------------------
  // The press remembers where the note was and where the pointer was, so the
  // point that was grabbed stays under the pointer however far it moves.
  const pressRef = useRef<{
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);
  const pendingRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // The newest document, note and callback, for the listeners that live on
  // `window` while a press lasts: they are added on press and removed on
  // release, and must see the note and document of the render they run in.
  const latest = useRef({ doc, note, onSelect });
  latest.current = { doc, note, onSelect };

  // One pair of stable window listeners, made once. The drag is tracked on the
  // window, not on the note element, for two reasons: bringing a note to the
  // front re-inserts its element in the document, which loses the pointer
  // capture, and a pointer moved faster than the note it carries can run off the
  // note while the position update waits for its frame (`sticky.drag`).
  const trackRef = useRef<(event: PointerEvent) => void>(() => {});
  const dragRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  } | null>(null);
  if (!dragRef.current) {
    // One pair of listeners for every press of this note: both simply hand the
    // event to the newest press handler, so their identity never changes and
    // removeEventListener always finds what addEventListener added.
    const track = (event: PointerEvent): void => trackRef.current(event);
    dragRef.current = { move: track, up: track };
  }

  const stopDrag = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const pair = dragRef.current;
    if (pair) {
      window.removeEventListener('pointermove', pair.move, true);
      window.removeEventListener('pointerup', pair.up, true);
      window.removeEventListener('pointercancel', pair.up, true);
    }
    draggingRef.current = false;
    setDragging(false);
  }, []);

  // The note may be deleted by someone else mid-drag; then the drag simply ends.
  const stillOpen = useCallback(
    () => getStickyText(doc, note.id) !== undefined,
    [doc, note.id],
  );

  // Written during render so the frame always sees the newest doc, zoom and
  // press. One update per frame, latest pointer position wins (`sticky.drag`).
  const applyRef = useRef<() => void>(() => {});
  applyRef.current = () => {
    const press = pressRef.current;
    const target = pendingRef.current;
    if (!press || !target) return;
    pendingRef.current = null;
    if (!stillOpen()) {
      pressRef.current = null;
      stopDrag();
      return;
    }
    const scale = zoomRef.current > 0 ? zoomRef.current : 1;
    moveObject(
      doc,
      note.id,
      press.x + (target.clientX - press.clientX) / scale,
      press.y + (target.clientY - press.clientY) / scale,
    );
  };

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return; // one coalesced update per frame
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      applyRef.current();
    });
  }, []);

  // A drag that is still running when the note disappears must not keep asking
  // for frames.
  useEffect(() => stopDrag, [stopDrag]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // The note owns this pointer: the board must not pan and a double-click
    // here must not create a note behind it (`sticky.no_pan`).
    event.stopPropagation();
    if (editing) return; // clicks inside an editing note belong to its text
    const el = elRef.current;
    if (!el) return;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured; a press is fine.
      }
    }
    pressRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: note.x,
      y: note.y,
      pointerId: event.pointerId,
    };
    pendingRef.current = null;
    const pair = dragRef.current;
    if (pair) {
      // Capture phase: the events are seen wherever the pointer ends up going,
      // including into the note's own text while the note follows it.
      window.addEventListener('pointermove', pair.move, true);
      window.addEventListener('pointerup', pair.up, true);
      window.addEventListener('pointercancel', pair.up, true);
    }
  };

  // One handler for the whole press, on the window: moves, then the release.
  trackRef.current = (event: PointerEvent) => {
    const press = pressRef.current;
    if (!press || event.pointerId !== press.pointerId) return;
    if (event.type === 'pointermove') {
      const { doc: boardDoc, note: current } = latest.current;
      pendingRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (draggingRef.current) {
        schedule();
        return;
      }
      const dx = event.clientX - press.clientX;
      const dy = event.clientY - press.clientY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a short press
      // A drag begins: come to the front once, then follow the pointer. This
      // re-inserts the note's element, so the pointer capture is lost here; the
      // press goes on regardless, because it is tracked on the window.
      bringToFront(boardDoc, current.id);
      draggingRef.current = true;
      setDragging(true);
      applyRef.current();
      return;
    }
    event.stopPropagation();
    const wasDragging = draggingRef.current;
    // A drag applies its last position, which then stays exactly under the
    // pointer; a press that never reached the threshold has not moved anything.
    if (wasDragging) applyRef.current();
    pressRef.current = null;
    pendingRef.current = null;
    stopDrag();
    // A short press selects, and so does a finished drag (`sticky.select`).
    latest.current.onSelect(latest.current.note.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Editing must not reach the board, which would create a new note here.
    event.preventDefault();
    event.stopPropagation();
    onStartEdit(note.id);
  };

  // --- text fitting ---------------------------------------------------------
  // Whichever element shows the text now — the display box or the editor's
  // textarea — is measured in its own coordinate space (world units).
  useLayoutEffect(() => {
    const measured =
      textRef.current ??
      elRef.current?.querySelector<HTMLElement>('[data-sticky-text-box="true"]') ??
      null;
    if (!measured) return;
    const next = fitFontSize(measured, TEXT_BOX_WORLD);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [note.text, editing, fit.fontPx]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const fill = STICKY_COLORS[note.color];
  const style = {
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${STICKY_SIZE_WORLD}px`,
    height: `${STICKY_SIZE_WORLD}px`,
    backgroundColor: fill,
    '--sticky-fill': fill,
    zIndex: Math.max(0, Math.round(note.z)),
    fontSize: `${fit.fontPx}px`,
  } as CSSProperties;

  return (
    <div
      ref={elRef}
      className="sticky-note"
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-color={note.color}
      data-x={note.x}
      data-y={note.y}
      data-z={note.z}
      style={style}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {ytext ? (
        <StickyTextEditor key={note.id} ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textRef}
          className="sticky-text"
          data-testid="sticky-text"
          data-sticky-text-box="true"
        >
          {note.text}
        </div>
      )}

      {/* Text past what fits is clipped, with a fade at the bottom edge. */}
      {fit.overflow ? <div className="sticky-fade" data-testid="sticky-fade" aria-hidden="true" /> : null}

      {/* The toolbar is hidden while Dragging or Editing, and is counter-scaled
          by its anchor so it stays the same size on screen at any zoom. */}
      {selected && !editing && !dragging ? (
        <div
          className="note-toolbar-anchor"
          data-testid="note-toolbar-anchor"
          style={{ transform: `scale(${1 / (zoom > 0 ? zoom : 1)})`, transformOrigin: 'left bottom' }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color: StickyColor) => {
              setStickyColor(doc, note.id, color);
            }}
            onDelete={() => {
              deleteObject(doc, note.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
