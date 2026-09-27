import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config.js';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model.js';
import { fitFontSize, NOTE_PADDING_PX } from './StickyText.js';
import { StickyTextEditor } from './StickyTextEditor.js';
import { NoteToolbar } from './NoteToolbar.js';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, used to turn a screen-space drag into world units. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** The inner content box of a note: its world size minus the text padding on both edges. */
const TEXT_BOX = STICKY_SIZE_WORLD - 2 * NOTE_PADDING_PX;

type Phase = 'idle' | 'pressed' | 'dragging';

/**
 * One sticky note on the board: it renders, selects, drags, edits, recolours and
 * deletes itself through the board-model, and never lets the viewport pan while it is
 * being dragged (every pointer gesture is stopped from propagating to the board).
 *
 * The pointer interaction follows the per-note state diagram: a press that never passes
 * `DRAG_THRESHOLD_PX` selects; a press that passes it raises the note once and then
 * moves it world-accurately (delta divided by zoom), one `requestAnimationFrame` at a
 * time. If the note vanishes from the document mid-drag (`moveObject` starts returning
 * false) the interaction ends silently.
 */
export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_SIZE_WORLD,
    overflow: false,
  });
  const [dragging, setDragging] = useState(false);

  // Auto-fit runs on mount and whenever the text changes — never on zoom (the font is
  // in world units, so the world-layer transform scales it uniformly).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el) setFit(fitFontSize(el, TEXT_BOX));
  }, [note.text, editing]);

  // --- drag state (refs so pointermove stays allocation-free) ---
  const phaseRef = useRef<Phase>('idle');
  const pointerIdRef = useRef<number | null>(null);
  const startClientRef = useRef({ x: 0, y: 0 });
  const startWorldRef = useRef({ x: 0, y: 0 });
  const latestRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const frameRef = useRef(0);
  const idRef = useRef(note.id);
  idRef.current = note.id;

  const stopFrame = (): void => {
    if (frameRef.current !== 0 && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = 0;
  };

  const endInteraction = useCallback((): void => {
    stopFrame();
    if (
      pointerIdRef.current !== null &&
      typeof rootRef.current?.hasPointerCapture === 'function' &&
      rootRef.current.hasPointerCapture(pointerIdRef.current)
    ) {
      try {
        rootRef.current.releasePointerCapture(pointerIdRef.current);
      } catch {
        // capture may already be gone; nothing to clean
      }
    }
    pointerIdRef.current = null;
    if (phaseRef.current !== 'idle') {
      phaseRef.current = 'idle';
      setDragging(false);
    }
  }, []);

  // Clean up any capture / frame when the note unmounts mid-interaction (stale id).
  useEffect(() => endInteraction, [endInteraction]);

  const commitMove = useCallback((): void => {
    frameRef.current = 0;
    if (phaseRef.current !== 'dragging') return;
    const target = latestRef.current;
    // A note deleted mid-drag makes moveObject return false: end the drag, recreate nothing.
    if (!moveObject(doc, idRef.current, target.x, target.y)) endInteraction();
  }, [doc, endInteraction]);

  const scheduleMove = useCallback((): void => {
    if (frameRef.current !== 0) return;
    if (typeof requestAnimationFrame === 'undefined') {
      commitMove();
      return;
    }
    frameRef.current = requestAnimationFrame(commitMove);
  }, [commitMove]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (editing) return; // the textarea owns input while editing
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // A note owns its own pointer; the board must not pan under it.
    event.stopPropagation();
    event.preventDefault();

    phaseRef.current = 'pressed';
    startClientRef.current = { x: event.clientX, y: event.clientY };
    startWorldRef.current = { x: note.x, y: note.y };
    latestRef.current = { x: note.x, y: note.y };
    pointerIdRef.current = event.pointerId;
    rootRef.current?.setPointerCapture?.(event.pointerId);
    // A press selects the note it lands on.
    onSelect(note.id);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (phaseRef.current !== 'pressed' && phaseRef.current !== 'dragging') return;
    const dxScreen = event.clientX - startClientRef.current.x;
    const dyScreen = event.clientY - startClientRef.current.y;
    const distance = Math.hypot(dxScreen, dyScreen);

    if (phaseRef.current === 'pressed') {
      // Below the threshold this is still a press; exactly the threshold begins a drag.
      if (distance < DRAG_THRESHOLD_PX) return;
      phaseRef.current = 'dragging';
      setDragging(true);
      bringToFront(doc, idRef.current);
    }

    const z = zoomRef.current || 1;
    latestRef.current = {
      x: startWorldRef.current.x + dxScreen / z,
      y: startWorldRef.current.y + dyScreen / z,
    };
    scheduleMove();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (phaseRef.current === 'dragging') {
      // Land exactly where the pointer is, never one coalesced frame short.
      const z = zoomRef.current || 1;
      latestRef.current = {
        x: startWorldRef.current.x + (event.clientX - startClientRef.current.x) / z,
        y: startWorldRef.current.y + (event.clientY - startClientRef.current.y) / z,
      };
      moveObject(doc, idRef.current, latestRef.current.x, latestRef.current.y);
    }
    // Pressed or Dragging both settle on Selected (still selected; outline + toolbar show).
    endInteraction();
  };

  const onCancel = (): void => {
    // pointercancel / lostpointercapture: keep the note where it was last shown.
    if (phaseRef.current === 'dragging') {
      const target = latestRef.current;
      moveObject(doc, idRef.current, target.x, target.y);
    }
    endInteraction();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // A double-click edits this note; it must not create a new one behind it.
    event.stopPropagation();
    onStartEdit(note.id);
  };

  const onColor = (color: StickyColor): void => {
    setStickyColor(doc, note.id, color);
  };

  const onDelete = (): void => {
    // Removing the note also clears the local selection (endEdit('unselected')).
    deleteObject(doc, note.id);
    onEndEdit('unselected');
  };

  const ytext = getStickyText(doc, note.id);

  return (
    <div
      ref={rootRef}
      className="vidi-note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        zIndex: note.z,
        background: STICKY_COLORS[note.color],
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onCancel}
      onLostPointerCapture={onCancel}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        // Reachable by Tab; focusing selects so Enter can start editing.
        onSelect(note.id);
      }}
    >
      <div
        ref={textRef}
        className={`vidi-note-text${fit.overflow ? ' vidi-note-overflow' : ''}`}
        data-overflow={fit.overflow ? 'true' : 'false'}
        style={{ inset: NOTE_PADDING_PX, fontSize: `${fit.fontPx}px` }}
      >
        {note.text}
      </div>

      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      ) : null}

      {selected && !editing && !dragging ? (
        <div
          className="vidi-note-toolbar-layer"
          style={{ transform: `translateY(${-100 * zoom}px) scale(${1 / zoom})` }}
        >
          <NoteToolbar color={note.color} onColor={onColor} onDelete={onDelete} />
        </div>
      ) : null}
    </div>
  );
}
