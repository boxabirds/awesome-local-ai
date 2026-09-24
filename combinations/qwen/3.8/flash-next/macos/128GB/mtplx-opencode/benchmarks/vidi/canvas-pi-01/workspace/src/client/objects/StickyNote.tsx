/**
 * Story 2 · task 5 — the sticky note (design "Sticky note interaction").
 *
 * One note is an absolutely positioned `div[role=group][aria-label="Sticky
 * note"]` in the (scaled) world layer at world `(x, y)`. It owns a small local
 * interaction state machine — Pressed → Dragging → Selected — and drives the
 * board model: a drag raises the note once and moves it in world units (the
 * screen delta divided by zoom), so the grabbed point stays under the pointer
 * at any zoom. Pointer-down stops propagation so the board neither pans nor
 * creates a note. Selection and editing are the parent's concern (props in,
 * callbacks out); if the note disappears mid-gesture the interaction simply
 * ends.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
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
import { fitText } from './StickyText';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Clear the selection after the delete button removes this note. */
  onDelete(id: string): void;
}

/** Padding between the note edge and its text, in world units. */
const PADDING = 14;

type Phase = 'idle' | 'pressed' | 'dragging';

interface DragState {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  raised: boolean;
  phase: Phase;
}

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onDelete } = props;
  const { id, x, y, color, text } = note;

  const [phase, setPhase] = useState<Phase>('idle');
  const [displayFont, setDisplayFont] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  const dragRef = useRef<DragState | null>(null);

  // A note deleted (via the model) mid-gesture ends its interaction silently:
  // no move after it is gone, and no re-creation (TC-37).
  useEffect(() => {
    if (getStickyText(doc, id) === undefined) {
      dragRef.current = null;
      setPhase('idle');
    }
  }, [doc, id, text]);

  // Auto-fit the *display* text (the editor fits its own textarea instead).
  useLayoutEffect(() => {
    if (editing) return;
    setDisplayFont(fitText(text, STICKY_SIZE_WORLD - PADDING * 2, STICKY_SIZE_WORLD - PADDING * 2));
  }, [text, editing]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The note owns its pointer: the board must not pan or create underneath.
    event.stopPropagation();
    if (editing) return; // a click inside an editing note stays in the editor
    if (event.button !== 0) return;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom / engines without pointer capture: capture is skipped.
    }
    onSelect(id);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: x,
      originY: y,
      raised: false,
      phase: 'pressed',
    };
    setPhase('pressed');
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (editing) return;
    const drag = dragRef.current;
    if (!drag) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (drag.phase === 'pressed') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a press
      // Crossed the threshold: this is a drag. Raise once, then move.
      bringToFront(doc, id);
      drag.raised = true;
      drag.phase = 'dragging';
      setPhase('dragging');
    }

    // Convert the screen delta to world units at the current zoom.
    const worldX = drag.originX + dx / zoom;
    const worldY = drag.originY + dy / zoom;
    moveObject(doc, id, worldX, worldY);
  };

  const endInteraction = () => {
    dragRef.current = null;
    setPhase('idle');
  };

  const onDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!editing) onStartEdit(id);
  };

  const showToolbar = selected && !editing && phase === 'idle';
  const inverse = zoom > 0 ? 1 / zoom : 1;
  const ytext = editing ? getStickyText(doc, id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid={`note-${id}`}
      data-note-id={id}
      data-phase={phase}
      data-selected={selected ? 'true' : 'false'}
      data-x={x}
      data-y={y}
      tabIndex={0}
      className="sticky-note"
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        backgroundColor: STICKY_COLORS[color],
        pointerEvents: 'auto',
        touchAction: 'none',
        boxShadow: '0 6px 16px rgba(16, 24, 40, 0.18)',
        outline: selected ? '2px solid #2f6fed' : 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onLostPointerCapture={endInteraction}
      onDoubleClick={onDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          initial={text}
          box={STICKY_SIZE_WORLD - PADDING * 2}
          padding={PADDING}
          fontPx={STICKY_FONT_MAX_PX}
          onEnd={props.onEndEdit}
        />
      ) : (
        <div
          className={`sticky-content sticky-display${displayFont.overflow ? ' text-overflow-fade' : ''}`}
          data-testid="sticky-display"
          style={{
            padding: `${PADDING}px`,
            fontSize: `${displayFont.fontPx}px`,
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
          }}
        >
          {text}
        </div>
      )}

      {showToolbar ? (
        <div
          className="note-toolbar-anchor"
          style={{
            position: 'absolute',
            top: `${-36 * inverse}px`,
            left: '0px',
            transform: `scale(${inverse})`,
            transformOrigin: 'top left',
            pointerEvents: 'auto',
          }}
        >
          <NoteToolbar
            color={color}
            onColor={(next: StickyColor) => {
              setStickyColor(doc, id, next);
            }}
            onDelete={() => onDelete(id)}
          />
        </div>
      ) : null}
    </div>
  );
}