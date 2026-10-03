import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
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
import { NoteToolbar } from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { StickyTextEditor, type EditEnd } from './StickyTextEditor';

export interface StickyNoteProps {
  /** Plain data, from the board model's snapshot. */
  note: StickySnapshot;
  /** Operations go to the document, never to props or local state. */
  doc: Y.Doc;
  /** Current zoom, so screen movement can be turned into world movement. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  /** Escape keeps the note selected; a press outside the note deselects it. */
  onEndEdit(next: EditEnd): void;
}

/** idle -> pressed -> dragging -> idle; `editing` is separate (see design.state). */
type Press = {
  pointerId: number;
  startX: number;
  startY: number;
  /** Where the note was when the pointer went down, in world units. */
  worldX: number;
  worldY: number;
  dragging: boolean;
};

type PressListeners = {
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  cancel: (event: PointerEvent) => void;
};

function capturePointer(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // setPointerCapture throws if the pointer is already gone
  }
}

function releasePointer(el: HTMLElement, pointerId: number): void {
  try {
    if (el.hasPointerCapture?.(pointerId)) {
      el.releasePointerCapture(pointerId);
    }
  } catch {
    // Already released: the drag is ending either way.
  }
}

/** Height available for text, in world units (jsdom lays nothing out at all). */
function textBox(el: HTMLElement): number {
  return el.clientHeight > 0 ? el.clientHeight : STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;
}

/**
 * A sticky note: a coloured square of fixed world size with text centred in it, that can
 * be dragged with one pointer, double-clicked (or Enter) to type in, recoloured and
 * deleted.
 *
 * Two rules keep it consistent with everything else in the app:
 *
 * - The note is *positioned*, never sized, by `left`/`top` in world units, so the world
 *   layer's `scale(zoom)` gives it screen size for free.
 * - Every change is applied to the shared document through the board model, and the note
 *   then re-renders from the document snapshot it is given. Nothing here holds a copy of
 *   the note's position or text in state, so there is no second truth to get out of step
 *   (which is what would make a note jump when a peer's change arrives, story 3).
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
  const ref = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);
  const pressRef = useRef<Press | null>(null);
  const listenersRef = useRef<PressListeners | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(zoom);
  const idRef = useRef(note.id);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    zoomRef.current = zoom;
  });
  useEffect(() => {
    idRef.current = note.id;
  });
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // A drag that ends because the note itself went away must not leave a frame or a window
  // listener behind that would write to a note this component no longer owns.
  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    },
    [],
  );

  /** The note's text, which lives in the document as a `Y.Text` (story 3 needs that). */
  const ytext = useMemo(() => getStickyText(doc, note.id), [doc, note.id]);

  const stopPress = useCallback((): void => {
    const el = ref.current;
    const press = pressRef.current;
    const listeners = listenersRef.current;
    if (listeners !== null) {
      window.removeEventListener('pointermove', listeners.move);
      window.removeEventListener('pointerup', listeners.up);
      window.removeEventListener('pointercancel', listeners.cancel);
      listenersRef.current = null;
    }
    if (el !== null && press !== null) {
      releasePointer(el, press.pointerId);
    }
    pressRef.current = null;
    pendingRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setDragging(false);
  }, []);

  /** Select the note, unless it has meanwhile disappeared from the document. */
  const selectSelf = useCallback((): void => {
    if (getStickyText(doc, idRef.current) !== undefined) {
      onSelectRef.current(idRef.current);
    }
  }, [doc]);

  /** Apply at most one position per frame: the document is not a per-mouse-move log. */
  const flushMove = useCallback((): void => {
    frameRef.current = null;
    const target = pendingRef.current;
    pendingRef.current = null;
    if (target === null) {
      return;
    }
    const id = idRef.current;
    moveObject(doc, id, target.x, target.y);
    if (getStickyText(doc, id) === undefined) {
      // The note is gone (deleted by somebody else, story 3): stop dragging it.
      stopPress();
    }
  }, [doc, stopPress]);

  const scheduleMove = useCallback((): void => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(flushMove);
    }
  }, [flushMove]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // A note is not the board: the press must never start a pan.
    event.stopPropagation();
    if (editing) {
      // While typing, a press inside the note edits text (the textarea gets it first).
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const el = ref.current;
    if (el === null) {
      return;
    }
    onSelectRef.current(note.id);
    if (document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
    // The note comes to the front as it is grabbed, so it is never dragged out of sight
    // behind its neighbours.
    bringToFront(doc, note.id);
    capturePointer(el, event.pointerId);

    const press: Press = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      worldX: note.x,
      worldY: note.y,
      dragging: false,
    };
    pressRef.current = press;
    setDragging(false);

    // The drag is tracked on the window, not only on the note element. Bringing the note to
    // the front re-orders its element in the document, and Chromium answers that by taking
    // pointer capture away - a drag that listened only to its own element would stop dead on
    // the first move, on any note that was not already on top.
    const move = (event2: PointerEvent): void => {
      if (event2.pointerId !== press.pointerId) {
        return;
      }
      const dx = event2.clientX - press.startX;
      const dy = event2.clientY - press.startY;
      if (!press.dragging) {
        // Two pixels of jitter must not move a note: the threshold decides when a press
        // becomes a drag, so a click on a small note still works.
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
          return;
        }
        press.dragging = true;
        setDragging(true);
      }
      const scale = zoomRef.current > 0 ? zoomRef.current : 1;
      pendingRef.current = { x: press.worldX + dx / scale, y: press.worldY + dy / scale };
      scheduleMove();
    };

    const up = (event2: PointerEvent): void => {
      if (event2.pointerId !== press.pointerId) {
        return;
      }
      if (pendingRef.current !== null) {
        // Finish where the pointer stopped, rather than one frame short of it.
        flushMove();
      }
      stopPress();
      // A press without movement is a select; a drag selects the note it moved.
      selectSelf();
    };

    const cancel = (event2: PointerEvent): void => {
      if (event2.pointerId !== press.pointerId) {
        return;
      }
      // Interrupted: the note stays where it was last put, and becomes the selected note.
      stopPress();
      selectSelf();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    listenersRef.current = { move, up, cancel };
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const press = pressRef.current;
    if (press === null || event.pointerId !== press.pointerId) {
      return;
    }
    if (event.buttons !== 0) {
      // Capture came and went in the middle of the gesture: bringing the note to the front
      // moved its element, and the browser took capture back with it. The pointer is still
      // down, so this is not the end of the drag; the window listeners carry on with it.
      return;
    }
    // The pointer is gone without a pointerup (the browser took it away): as with a cancel.
    stopPress();
    selectSelf();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Stop it reaching the board, which would otherwise add a second note here.
    event.stopPropagation();
    if (!editing) {
      onStartEdit(note.id);
    }
  };

  const onColor = (color: StickyColor): void => {
    setStickyColor(doc, note.id, color);
  };

  // Auto-fit: the largest font in the allowed range at which the text still fits, so a
  // one-word note is big and a full note is small. Only needed while the text is shown
  // (the editor fits itself as you type).
  useLayoutEffect(() => {
    if (editing) {
      return;
    }
    const el = textRef.current;
    if (el === null) {
      return;
    }
    const fit = fitFontSize(el, textBox(el));
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [editing, note.text]);

  // After Escape the note keeps the selection; give the keyboard somewhere to go, so
  // Enter edits it again and Delete removes it.
  const wasEditingRef = useRef(false);
  useEffect(() => {
    if (wasEditingRef.current && !editing) {
      ref.current?.focus({ preventScroll: true });
    }
    wasEditingRef.current = editing;
  }, [editing]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Only keys pressed on the note itself. Delete and Enter are handled once at window
    // level; here Space is stopped from scrolling the board. Keys that belong to the text
    // editor inside this note - a space typed into the text - are left completely alone,
    // or the note would be impossible to type in.
    if (editing || event.target !== event.currentTarget) {
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
    }
  };

  const color = STICKY_COLORS[note.color];
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      ref={ref}
      className="sticky-note"
      data-sticky-note=""
      data-testid="sticky-note"
      data-note-id={note.id}
      data-color={note.color}
      data-x={note.x}
      data-y={note.y}
      data-z={note.z}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: color,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onLostPointerCapture={onLostPointerCapture}
    >
      {/* Everything that belongs to the note's face is inside a clipping box, so text
          that is too long is cut off by the note instead of spilling over the board - and
          so the toolbar below is the one thing allowed to stick out. */}
      <div className="sticky-note__clip">
        {editing && ytext !== undefined ? (
          <StickyTextEditor
            ytext={ytext}
            fontPx={fontPx}
            onEnd={(next: EditEnd) => {
              onEndEdit(next);
            }}
          />
        ) : (
          <div
            ref={textRef}
            className="sticky-note__text"
            data-testid="sticky-note-text"
            style={{ fontSize: `${fontPx}px` }}
          >
            {note.text}
          </div>
        )}
        {!editing && overflow ? (
          <div
            className="sticky-note__fade"
            data-testid="sticky-note-fade"
            data-overflow="true"
            aria-hidden="true"
          />
        ) : null}
      </div>
      {showToolbar ? (
        <div
          className="sticky-note__toolbar-anchor"
          data-board-ui=""
          /* The toolbar hangs above the note and is scaled by 1/zoom, so it keeps its
              screen size however far out the board is zoomed. */
          style={{ '--inv-zoom': zoom > 0 ? String(1 / zoom) : '1' } as CSSProperties}
        >
          <NoteToolbar
            color={note.color}
            onColor={onColor}
            onDelete={() => {
              // The board forgets the note entirely; the selection goes with it.
              onEndEdit('unselected');
              deleteObject(doc, note.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
