import {
  useRef,
  useCallback,
  useEffect,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '@shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS } from '@shared/config';
import { StickyTextEditor } from './StickyTextEditor';
import { getStickyText } from '@shared/board-model';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** When false (e.g. board not loaded), drag and edit are disabled; selection stays. */
  editable?: boolean;
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export function StickyNote({
  note,
  doc,
  zoom: _zoom,
  selected,
  editing,
  editable = true,
  onObjectPointerDown,
  onSelect,
  onToggle,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): ReactElement {
  const elRef = useRef<HTMLDivElement | null>(null);
  const pressedRef = useRef(false);
  const movedRef = useRef(false);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const noteIdRef = useRef(note.id);
  noteIdRef.current = note.id;
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const onObjectPointerDownRef = useRef(onObjectPointerDown);
  onObjectPointerDownRef.current = onObjectPointerDown;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  // End interaction if note is deleted mid-edit
  useEffect(() => {
    if (!selected && !editing) return;
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    if (!objects.has(note.id)) {
      pressedRef.current = false;
    }
  }, [note.id, selected, editing, doc]);

  const handlePointerDown = useCallback(
    (e: globalThis.PointerEvent | React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      // Shift+click toggles selection
      if (e.shiftKey) {
        onToggleRef.current(noteIdRef.current);
        return;
      }

      const nativeEvent = ('nativeEvent' in e ? e.nativeEvent : e) as globalThis.PointerEvent;

      // Check if already selected (multi-select move) or not (select + move)
      pressedRef.current = true;
      movedRef.current = false;
      downPosRef.current = { x: e.clientX, y: e.clientY };

      const el = elRef.current;
      if (el) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* jsdom may not support */
        }
      }

      onObjectPointerDownRef.current(nativeEvent, noteIdRef.current);
    },
    [],
  );

  const handlePointerUp = useCallback(
    (_e: ReactMouseEvent | globalThis.PointerEvent) => {
      if (pressedRef.current && !movedRef.current) {
        // Simple click without drag: just select (the gesture already selected)
        // But if shift wasn't held and we didn't move, the gesture handles it
      }
      pressedRef.current = false;
      movedRef.current = false;
      downPosRef.current = null;
    },
    [],
  );

  const handleDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!editableRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      onStartEdit(note.id);
    },
    [note.id, onStartEdit],
  );

  const handleEditorEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      onEndEdit(next);
    },
    [onEndEdit],
  );

  const ytext = getStickyText(doc, note.id);
  const bgColor = STICKY_COLORS[note.color];

  const noteWidth = note.width ?? STICKY_SIZE_WORLD;
  const noteHeight = note.height ?? STICKY_SIZE_WORLD;

  // Compute font size for display mode
  const displayFontPx = note.text.length > 200 ? 14 : note.text.length > 50 ? 18 : 24;

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Sticky note"
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}`}
      data-selected={selected ? 'true' : 'false'}
      data-object-id={note.id}
      data-testid={`sticky-note-${note.id}`}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: noteWidth,
        height: noteHeight,
        backgroundColor: bgColor,
      }}
      onPointerDown={handlePointerDown as (e: React.PointerEvent<HTMLDivElement>) => void}
      onPointerUp={handlePointerUp as (e: React.PointerEvent<HTMLDivElement>) => void}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext && editable ? (
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
