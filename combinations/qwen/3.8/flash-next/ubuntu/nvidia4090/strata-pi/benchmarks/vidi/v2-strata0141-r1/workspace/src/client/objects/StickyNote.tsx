import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { fitFontSize, type FontFit } from './StickyText';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';

/**
 * One sticky note (anchor `sticky.interaction`).
 *
 * Lifecycle of the interaction states:
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Unselected
 *     Unselected --> Pressed : pointerdown
 *     Pressed --> Selected : pointerup within DRAG_THRESHOLD_PX
 *     Pressed --> Dragging : move beyond DRAG_THRESHOLD_PX
 *     Dragging --> Selected : pointerup or pointercancel
 *     Selected --> Editing : dblclick or Enter
 *     Editing --> Selected : Escape
 *     Editing --> Unselected : click outside
 *     Selected --> Unselected : click empty board
 *     Selected --> [*] : Delete key or bin button
 * ```
 */
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

type Phase = 'idle' | 'pressed' | 'dragging';

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  dragging: boolean;
  /** Latest pointer offset, applied once per animation frame. */
  pending: { dx: number; dy: number } | null;
}

/** The text box inside the note's padding, in board units. */
const TEXT_BOX = STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD;

export function StickyNote(props: StickyNoteProps) {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;

  const [phase, setPhase] = useState<Phase>('idle');
  const [fit, setFit] = useState<FontFit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const noteRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const frameRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /**
   * Auto-fit: measured only when the text changes, never on pointer or zoom
   * events. `fitFontSize` sets the font size on the element while searching.
   */
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) {
      return;
    }
    setFit(fitFontSize(el, TEXT_BOX));
  }, [note.text]);

  const releaseCapture = useCallback((pointerId: number) => {
    const el = noteRef.current;
    try {
      if (el?.hasPointerCapture?.(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
    } catch {
      // jsdom implements neither method.
    }
  }, []);

  const finishInteraction = useCallback(() => {
    if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
    dragRef.current = null;
    setPhase('idle');
  }, []);

  /** The note vanished (deleted elsewhere) while the interaction was running. */
  const noteStillExists = useCallback((): boolean => getStickyText(doc, note.id) !== undefined, [doc, note.id]);

  const applyDrag = useCallback(() => {
    frameRef.current = null;
    const drag = dragRef.current;
    if (!drag || !drag.pending) {
      return;
    }
    const cameraZoom = zoomRef.current || 1;
    const x = drag.originX + drag.pending.dx / cameraZoom;
    const y = drag.originY + drag.pending.dy / cameraZoom;
    if (!moveObject(doc, note.id, x, y) && !noteStillExists()) {
      finishInteraction(); // TC-37: end silently
    }
  }, [doc, finishInteraction, note.id, noteStillExists]);

  const scheduleDrag = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }
    if (typeof requestAnimationFrame === 'function') {
      frameRef.current = requestAnimationFrame(applyDrag);
    } else {
      applyDrag();
    }
  }, [applyDrag]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // The viewport must neither pan nor create a note (TC-20).
      event.stopPropagation();
      if (editing || event.button !== 0) {
        return;
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: note.x,
        originY: note.y,
        dragging: false,
        pending: null,
      };
      try {
        noteRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // jsdom: no pointer capture, events still bubble to this element.
      }
      setPhase('pressed');
    },
    [editing, note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      event.stopPropagation();
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
          return; // below the threshold: still a possible click (TC-19)
        }
        drag.dragging = true;
        bringToFront(doc, note.id); // drawn above everything it overlaps
        setPhase('dragging');
      }
      drag.pending = { dx, dy };
      scheduleDrag();
    },
    [doc, note.id, scheduleDrag],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      event.stopPropagation();
      if (drag.dragging) {
        if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(frameRef.current);
        }
        applyDrag(); // land exactly under the pointer
      }
      releaseCapture(event.pointerId);
      finishInteraction();
      if (noteStillExists()) {
        onSelect(note.id);
      }
    },
    [applyDrag, finishInteraction, note.id, noteStillExists, onSelect, releaseCapture],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      event.stopPropagation();
      // A cancelled drag keeps the last applied position (TC-21).
      releaseCapture(event.pointerId);
      finishInteraction();
      if (noteStillExists()) {
        onSelect(note.id);
      }
    },
    [finishInteraction, note.id, noteStillExists, onSelect, releaseCapture],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // A double-click on a note edits it instead of creating one (TC-35).
      event.stopPropagation();
      event.preventDefault();
      onSelect(note.id);
      onStartEdit(note.id);
    },
    [note.id, onSelect, onStartEdit],
  );

  // The note was deleted while it was being dragged or edited (TC-37).
  useEffect(() => {
    if (!noteStillExists() && dragRef.current) {
      finishInteraction();
    }
  }, [finishInteraction, noteStillExists, note.id]);

  const dragging = phase === 'dragging';
  const showToolbar = selected && !editing && !dragging;

  const handleColor = useCallback(
    (color: StickyColor) => {
      setStickyColor(doc, note.id, color);
    },
    [doc, note.id],
  );

  const handleDelete = useCallback(() => {
    deleteObject(doc, note.id);
  }, [doc, note.id]);

  return (
    <div
      ref={noteRef}
      className="sticky-note"
      data-sticky-note={note.id}
      data-testid={`sticky-note-${note.id}`}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow,
        transform: `translate(${note.x}px, ${note.y}px)`,
        zIndex: note.z,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="sticky-note__clip"
        style={{ padding: `${STICKY_PADDING_WORLD}px` }}
      >
        <div
          ref={textRef}
          className="sticky-note__text"
          data-testid={`sticky-text-${note.id}`}
          style={{ fontSize: `${fit.fontPx}px` }}
        >
          {note.text}
        </div>
        {editing ? (
          <StickyTextEditor
            ytext={getStickyText(doc, note.id)!}
            fontPx={fit.fontPx}
            background={STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow}
            onEnd={onEndEdit}
          />
        ) : null}
        <div className="sticky-note__fade" data-testid={`sticky-fade-${note.id}`} aria-hidden="true" />
      </div>
      {showToolbar ? (
        <div
          className="sticky-note__toolbar"
          style={{ transform: `scale(${1 / (zoom || 1)})`, transformOrigin: '0 100%' }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      ) : null}
    </div>
  );
}
