import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import { getStickyText } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable?: boolean;
  onSelect(id: string): void;
  onToggleSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
  onObjectPointerDown?(e: PointerEvent, id: string): void;
}

export function StickyNote(props: StickyNoteProps) {
  const {
    note, doc, selected, editing, editable = true,
    onSelect, onToggleSelect, onStartEdit, onEndEdit, onObjectPointerDown,
  } = props;
  const elRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(24);
  const [overflow, setOverflow] = useState(false);

  const noteWidth = note.width ?? STICKY_SIZE_WORLD;
  const noteHeight = note.height ?? STICKY_SIZE_WORLD;

  // Fit font size on text change
  useEffect(() => {
    if (!textRef.current) return;
    const result = fitFontSize(textRef.current, noteWidth);
    setFontPx(result.fontPx);
    setOverflow(result.overflow);
  }, [note.text, noteWidth]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      if (editing) return;
      if (!editable) return;

      // Shift+click toggles selection
      if (e.shiftKey) {
        onToggleSelect(note.id);
        return;
      }

      // Delegate to the transform gesture which handles select, press, drag
      if (onObjectPointerDown) {
        onObjectPointerDown(e.nativeEvent as unknown as PointerEvent, note.id);
      } else {
        // Fallback: just select
        onSelect(note.id);
      }
    },
    [editing, editable, note.id, onSelect, onToggleSelect, onObjectPointerDown],
  );

  const handleDblClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!editable) return;
      onSelect(note.id);
      onStartEdit(note.id);
    },
    [note.id, onSelect, onStartEdit, editable],
  );

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const bgColor = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;

  return (
    <div
      ref={elRef}
      className={`sticky-note${selected ? ' sticky-selected' : ''}${overflow ? ' sticky-overflow' : ''}`}
      data-testid={`sticky-note-${note.id}`}
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: noteWidth,
        height: noteHeight,
        backgroundColor: bgColor,
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        outline: selected ? '2px solid #2563eb' : 'none',
        outlineOffset: -2,
        cursor: editing ? 'text' : 'grab',
        overflow: 'hidden',
        zIndex: note.z,
        userSelect: editing ? 'text' : 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fontPx}
          onEnd={() => onEndEdit()}
        />
      ) : (
        <div
          ref={textRef}
          className="sticky-note-text"
          style={{
            fontSize: fontPx,
            padding: '12px',
            width: '100%',
            height: '100%',
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {note.text}
        </div>
      )}
      {overflow && <div className="sticky-fade" data-testid="sticky-fade" />}
    </div>
  );
}
