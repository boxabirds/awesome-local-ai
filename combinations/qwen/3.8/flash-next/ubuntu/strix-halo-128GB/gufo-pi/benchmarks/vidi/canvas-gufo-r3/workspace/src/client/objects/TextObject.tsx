import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { TextSnapshot, getTextContent, deleteIfEmpty, setTextSize } from '@shared/objects/text';
import { TEXT_SIZES, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TextSize } from '@shared/config';
import { deleteObjects } from '@shared/board-model';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import { useTextBoxSync } from './useTextBoxSync';
import { createCanvasMeasurer, Measurer } from './textLayout';
import type { UndoController } from '@client/board/undo';

export interface TextObjectProps {
  note: TextSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging?: boolean;
  readOnly?: boolean;
  onSelect(id: string): void;
  onToggle?(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown?(e: React.PointerEvent, id: string): void;
  undoController?: UndoController | null;
}

const globalMeasurer: Measurer = createCanvasMeasurer();

export function TextObject({
  note,
  doc,
  zoom,
  selected,
  editing,
  dragging = false,
  readOnly,
  onSelect,
  onToggle,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  undoController,
}: TextObjectProps) {
  const fontPx = TEXT_SIZES[note.size];
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, globalMeasurer);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      if (editing) return;
      e.preventDefault();

      if (e.shiftKey && onToggle) {
        onToggle(note.id);
        return;
      }

      if (onObjectPointerDown) {
        onObjectPointerDown(e, note.id);
      } else {
        onSelect(note.id);
      }
    },
    [editing, note.id, onSelect, onToggle, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      e.stopPropagation();
      if (editing) return;
      onSelect(note.id);
      onStartEdit(note.id);
    },
    [editing, note.id, onSelect, onStartEdit],
  );

  const ytext = editing ? getTextContent(doc, note.id) : undefined;

  // Object deleted while editing → end silently
  useEffect(() => {
    if (editing && !ytext) onEndEdit('unselected');
  }, [editing, ytext, onEndEdit]);

  const handleEditorInput = useCallback(() => {
    remeasureAfterLocalChange();
  }, [remeasureAfterLocalChange]);

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      // Check if text is empty → delete the object
      const deleted = deleteIfEmpty(doc, note.id);
      if (deleted) {
        // Clear selection (object no longer exists)
        onEndEdit('unselected');
      } else {
        onEndEdit(next);
      }
    },
    [doc, note.id, onEndEdit],
  );

  const handleSize = useCallback(
    (s: TextSize) => {
      if (readOnly) return;
      undoController?.boundary();
      setTextSize(doc, note.id, s);
      remeasureAfterLocalChange();
      undoController?.boundary();
    },
    [doc, note.id, readOnly, undoController, remeasureAfterLocalChange],
  );

  const handleDelete = useCallback(() => {
    if (readOnly) return;
    undoController?.boundary();
    deleteObjects(doc, [note.id]);
    undoController?.boundary();
  }, [doc, note.id, readOnly, undoController]);

  const showToolbar = selected && !editing;

  return (
    <div
      data-testid="text-object-wrapper"
      data-note-id={note.id}
      data-x={note.x}
      data-y={note.y}
      data-z={note.z}
      data-width={note.width}
      data-height={note.height}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        zIndex: note.z,
      }}
    >
      <div
        role="group"
        aria-label={note.text || 'Text object'}
        data-testid="text-object"
        data-note-id={note.id}
        data-selected={selected ? 'true' : 'false'}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onFocus={() => {
          if (!editing) onSelect(note.id);
        }}
        style={{
          position: 'absolute',
          inset: 0,
          outline: selected ? '2px solid #1976D2' : 'none',
          cursor: 'grab',
          touchAction: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: `${fontPx}px`,
          lineHeight: TEXT_LINE_HEIGHT,
          fontFamily: TEXT_FONT_FAMILY,
          color: '#222',
          userSelect: 'none',
        }}
      >
        <span className="text-object-plain" data-testid="text-object-display">{note.text.length > 0 ? note.text : '\u00A0'}</span>
        {editing && ytext && (
          <TextEditor
            key={note.id}
            ytext={ytext}
            maxChars={TEXT_MAX_CHARS}
            fontPx={fontPx}
            width={note.width}
            onInput={handleEditorInput}
            onEnd={handleEndEdit}
            undoController={undoController}
            style={{
              fontFamily: TEXT_FONT_FAMILY,
              color: '#222',
            }}
          />
        )}
      </div>
      {showToolbar && (
        <div
          data-testid="text-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `scale(${1 / (zoom > 0 ? zoom : 1)}) translate(0px, -44px)`,
            transformOrigin: '0 0',
            zIndex: 10,
          }}
        >
          <TextToolbar size={note.size} onSize={handleSize} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
