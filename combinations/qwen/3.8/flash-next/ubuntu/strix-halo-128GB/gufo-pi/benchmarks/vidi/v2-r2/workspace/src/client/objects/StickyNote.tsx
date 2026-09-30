import {
  useRef,
  useCallback,
  useEffect,
  useState,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '@shared/board-model';
import { moveObject, bringToFront } from '@shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DRAG_THRESHOLD_PX } from '@shared/config';
import { StickyTextEditor } from './StickyTextEditor';
import { getStickyText } from '@shared/board-model';

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

type InteractionState = 'unselected' | 'pressed' | 'selected' | 'dragging';

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): ReactElement {
  const elRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<InteractionState>(editing ? 'selected' : 'unselected');
  const [isDragging, setIsDragging] = useState(false);
  const dragOriginRef = useRef<{ px: number; py: number; nx: number; ny: number } | null>(null);
  const rafRef = useRef<number>(0);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const docRef = useRef(doc);
  docRef.current = doc;
  const noteIdRef = useRef(note.id);
  noteIdRef.current = note.id;
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;

  // End interaction if note is deleted mid-drag or mid-edit
  useEffect(() => {
    if (!selected && !editing && stateRef.current === 'unselected') return;
    // Check if note still exists in doc
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    if (!objects.has(note.id)) {
      stateRef.current = 'unselected';
      setIsDragging(false);
    }
  }, [note.id, selected, editing, doc]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const el = elRef.current;
      if (el) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* jsdom may not support */
        }
      }
      stateRef.current = 'pressed';
      dragOriginRef.current = {
        px: e.clientX,
        py: e.clientY,
        nx: note.x,
        ny: note.y,
      };
    },
    [note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (stateRef.current !== 'pressed' && stateRef.current !== 'dragging') return;
      const origin = dragOriginRef.current;
      if (!origin) return;
      const dx = e.clientX - origin.px;
      const dy = e.clientY - origin.py;

      if (stateRef.current === 'pressed') {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < DRAG_THRESHOLD_PX) return;
        // Transition to dragging
        stateRef.current = 'dragging';
        setIsDragging(true);
        bringToFront(docRef.current, noteIdRef.current);
      }

      // Update position via rAF
      const newNX = origin.nx + dx / zoomRef.current;
      const newNY = origin.ny + dy / zoomRef.current;
      pendingPosRef.current = { x: newNX, y: newNY };

      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const pos = pendingPosRef.current;
          if (pos) {
            const ok = moveObject(docRef.current, noteIdRef.current, pos.x, pos.y);
            if (!ok) {
              // Note deleted mid-drag, end silently
              stateRef.current = 'selected';
              setIsDragging(false);
            }
          }
        });
      }
    },
    [],
  );

  const handlePointerUp = useCallback(
    (_e: ReactPointerEvent) => {
      if (stateRef.current === 'pressed') {
        // Short press without movement -> select
        stateRef.current = 'selected';
        onSelect(note.id);
      } else if (stateRef.current === 'dragging') {
        stateRef.current = 'selected';
        setIsDragging(false);
      }
      dragOriginRef.current = null;
    },
    [note.id, onSelect],
  );

  const handlePointerCancel = useCallback(
    () => {
      if (stateRef.current === 'dragging') {
        stateRef.current = 'selected';
        setIsDragging(false);
      }
      dragOriginRef.current = null;
    },
    [],
  );

  const handleLostPointerCapture = useCallback(
    () => {
      if (stateRef.current === 'dragging') {
        stateRef.current = 'selected';
        setIsDragging(false);
      }
    },
    [],
  );

  const handleDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onStartEdit(note.id);
    },
    [note.id, onStartEdit],
  );

  // Handle outside click for editing - use a ref-based approach
  const handleEditorEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      onEndEdit(next);
    },
    [onEndEdit],
  );

  const ytext = getStickyText(doc, note.id);
  const bgColor = STICKY_COLORS[note.color];

  // Compute font size for display mode (simplified - in e2e fitFontSize would run)
  const displayFontPx = note.text.length > 200 ? 14 : note.text.length > 50 ? 18 : 24;

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Sticky note"
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}${isDragging ? ' sticky-note--dragging' : ''}`}
      data-selected={selected ? 'true' : 'false'}
      data-testid={`sticky-note-${note.id}`}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: bgColor,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={displayFontPx}
          onEnd={handleEditorEnd}
        />
      ) : (
        <div
          className={`sticky-note-text${note.text.length > 400 ? ' sticky-note-text--overflow' : ''}`}
          style={{ fontSize: displayFontPx }}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}
