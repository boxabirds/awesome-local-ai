import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  DRAG_THRESHOLD_PX,
} from '../../shared/config';
import {
  moveObject,
  bringToFront,
  getStickyText,
} from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const TEXT_BOX = STICKY_SIZE_WORLD - 24; // padding 12px each side

type NoteState = 'Unselected' | 'Pressed' | 'Selected' | 'Dragging' | 'Editing';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False while the board is locked (persist.load_failure): no drag, no editor. */
  editable?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}


/**
 * A sticky note on the board. Handles select, drag, double-click-to-edit.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  editable = true,
  onSelect,
  onStartEdit,
  onEndEdit,

}: StickyNoteProps): JSX.Element {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<NoteState>(editing ? 'Editing' : selected ? 'Selected' : 'Unselected');
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const dragStartWorldRef = useRef<{ x: number; y: number } | null>(null);

  // Track dragging state for re-rendering (hide toolbar while dragging)
  const [isDragging, setIsDragging] = useState(false);
  const [overflow, setOverflow] = useState(false);

  // Sync external state
  useEffect(() => {
    if (editing) {
      stateRef.current = 'Editing';
    } else if (stateRef.current === 'Dragging' || stateRef.current === 'Pressed') {
      // Don't interrupt an active drag/press gesture
    } else if (selected) {
      stateRef.current = 'Selected';
    } else {
      stateRef.current = 'Unselected';
    }
  }, [selected, editing]);

  // Check if note still exists (for stale-id handling)
  const objectsMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  useEffect(() => {
    if (!objectsMap.has(note.id)) {
      stateRef.current = 'Unselected';
      setIsDragging(false);
      if (editing) onEndEdit('unselected');
    }
  }, [note.id, objectsMap, editing, onEndEdit]);

  // Real font measurement after render (runs in browser, not jsdom)
  useLayoutEffect(() => {
    if (editing) return;
    const el = textRef.current;
    if (!el) return;
    if (note.text.length === 0) {
      el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
      setOverflow(false);
      return;
    }
    const box = el.clientHeight || TEXT_BOX;
    const result = fitFontSize(el, box);
    setOverflow(result.overflow);
  }, [note.text, editing]);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Locked board: a press never becomes a drag.
    if (!editable) return;
    event.stopPropagation();
    event.preventDefault();

    const el = elementRef.current;
    if (el && typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // best-effort
      }
    }

    pointerIdRef.current = event.pointerId;
    pressOriginRef.current = { x: event.clientX, y: event.clientY };

    if (stateRef.current !== 'Editing') {
      stateRef.current = 'Pressed';
    }
  }, [editable]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (stateRef.current !== 'Pressed' && stateRef.current !== 'Dragging') return;
    if (pointerIdRef.current !== null && pointerIdRef.current !== (event.pointerId ?? -1)) return;

    const origin = pressOriginRef.current;
    if (!origin) return;

    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (stateRef.current === 'Pressed') {
      if (distance < DRAG_THRESHOLD_PX) return;
      // Start dragging
      stateRef.current = 'Dragging';
      setIsDragging(true);
      bringToFront(doc, note.id);
      onSelect(note.id);
      dragStartWorldRef.current = { x: note.x, y: note.y };
    }

    // Apply move
    const z = zoomRef.current;
    const worldDx = dx / z;
    const worldDy = dy / z;
    const startWorld = dragStartWorldRef.current;
    if (!startWorld) return;
    const newX = startWorld.x + worldDx;
    const newY = startWorld.y + worldDy;
    const success = moveObject(doc, note.id, newX, newY);
    if (!success) {
      stateRef.current = 'Unselected';
    }
  }, [doc, note.id, note.x, note.y, onSelect]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== null && pointerIdRef.current !== (event.pointerId ?? -1)) return;
    pointerIdRef.current = null;
    pressOriginRef.current = null;
    dragStartWorldRef.current = null;

    if (stateRef.current === 'Pressed' || stateRef.current === 'Dragging') {
      stateRef.current = 'Selected';
      setIsDragging(false);
      onSelect(note.id);
    }
  }, [note.id, onSelect]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== null && pointerIdRef.current !== (event.pointerId ?? -1)) return;
    pointerIdRef.current = null;
    pressOriginRef.current = null;
    dragStartWorldRef.current = null;
    if (stateRef.current === 'Dragging' || stateRef.current === 'Pressed') {
      stateRef.current = 'Selected';
      setIsDragging(false);
    }
  }, []);

  const handleLostPointerCapture = useCallback((_event: ReactPointerEvent<HTMLDivElement>) => {
    if (stateRef.current === 'Dragging' || stateRef.current === 'Pressed') {
      stateRef.current = 'Selected';
      pointerIdRef.current = null;
      pressOriginRef.current = null;
      dragStartWorldRef.current = null;
      setIsDragging(false);
    }
  }, []);

  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (!editable) return;
    if (!objectsMap.has(note.id)) return;
    onStartEdit(note.id);
  }, [note.id, onStartEdit, objectsMap, editable]);

  const handleEditorEnd = useCallback((next: 'selected' | 'unselected') => {
    onEndEdit(next);
  }, [onEndEdit]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={elementRef}
      role="group"
      aria-label="Sticky note"
      data-testid={`sticky-note-${note.id}`}
      data-selected={selected ? 'true' : undefined}
      data-dragging={isDragging ? 'true' : undefined}
      data-note-id={note.id}
      className="sticky-note"
      style={{
        position: 'absolute',
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        backgroundColor: STICKY_COLORS[note.color],
        zIndex: note.z,
        cursor: editing ? 'text' : 'default',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
      tabIndex={0}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={STICKY_FONT_MAX_PX}
          onEnd={handleEditorEnd}
        />
      ) : (
        <div
          ref={textRef}
          className={`sticky-note-text${overflow ? ' overflow-fade' : ''}`}
          data-testid={`sticky-text-${note.id}`}
        >
          {note.text}
        </div>
      )}

    </div>
  );
}
