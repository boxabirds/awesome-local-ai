import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { TextSnapshot } from '../../shared/board-model';
import { deleteObject } from '../../shared/board-model';
import { TEXT_SIZES, TEXT_MAX_CHARS, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from '../../shared/config';
import { getTextContent, setTextSize, deleteIfEmpty } from '../../shared/objects/text';
import { createCanvasMeasurer, type Measurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import type { UndoController } from '../board/undo';

let sharedMeasurer: Measurer | null = null;
function getMeasurer(): Measurer {
  if (!sharedMeasurer) sharedMeasurer = createCanvasMeasurer();
  return sharedMeasurer;
}

export interface TextObjectProps {
  note: TextSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown?(e: React.PointerEvent<HTMLDivElement>, id: string): void;
  editable?: boolean;
  undoController?: UndoController;
}

/**
 * Text object: plain text with no background, rendered at stored position and size.
 * Handles selection, editing (double-click / Enter), size changes and empty-removal.
 */
export function TextObject({
  note,
  doc,
  zoom,
  selected,
  editing,
  dragging = false,
  onSelect,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  editable = true,
  undoController,
}: TextObjectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const measurer = getMeasurer();
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, measurer);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      if (editing) return;
      if (!editable) return;
      if (onObjectPointerDown) {
        onObjectPointerDown(e, note.id);
      }
    },
    [editing, editable, note.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (!editable) return;
      onStartEdit(note.id);
    },
    [note.id, onStartEdit, editable],
  );

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      const deleted = deleteIfEmpty(doc, note.id);
      if (deleted) {
        onEndEdit('unselected');
      } else {
        onEndEdit(next);
      }
    },
    [doc, note.id, onEndEdit],
  );

  // Watch for remote deletion during editing
  useEffect(() => {
    if (!editing) return;
    const check = () => {
      const ytext = getTextContent(doc, note.id);
      if (!ytext) {
        // Object was deleted remotely
        onEndEdit('unselected');
      }
    };
    // Check once at mount; the parent selection prune also handles this
    check();
  }, [editing, doc, note.id, onEndEdit]);

  const handleSize = useCallback(
    (size: string) => {
      if (!editable) return;
      undoController?.boundary();
      setTextSize(doc, note.id, size);
      remeasureAfterLocalChange();
      undoController?.boundary();
    },
    [doc, note.id, editable, undoController, remeasureAfterLocalChange],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    undoController?.boundary();
    deleteObject(doc, note.id);
    undoController?.boundary();
    onEndEdit('unselected');
  }, [doc, note.id, editable, undoController, onEndEdit]);

  const handleInput = useCallback(() => {
    remeasureAfterLocalChange();
  }, [remeasureAfterLocalChange]);

  const ytext = editing ? getTextContent(doc, note.id) : undefined;
  const width = note.width ?? 100;
  const height = note.height ?? Math.round(TEXT_SIZES[note.size] * TEXT_LINE_HEIGHT);
  const fontPx = TEXT_SIZES[note.size];

  // Focus on selected + not editing (for keyboard delete)
  useEffect(() => {
    if (selected && !editing) rootRef.current?.focus({ preventScroll: true });
  }, [selected, editing]);

  return (
    <div
      ref={rootRef}
      data-text-id={note.id}
      data-testid="text-object"
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={note.text || 'Text'}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: fontPx,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: TEXT_FONT_FAMILY,
        color: '#1f1f1f',
        outline: selected ? '2px solid #1976D2' : 'none',
        boxSizing: 'border-box',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        data-testid="text-object-content"
        style={{ opacity: editing ? 0 : 1, pointerEvents: 'none', width: '100%', height: '100%' }}
      >
        {note.text}
      </div>
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={note.widthMode === 'fixed' ? width : 'auto'}
          onInput={handleInput}
          onEnd={handleEndEdit}
          undoController={undoController}
        />
      )}
      {selected && !editing && !dragging && (
        <div
          data-testid="text-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            transform: `scale(${1 / (zoom || 1)})`,
            transformOrigin: 'bottom left',
            paddingBottom: 8,
          }}
        >
          <TextToolbar size={note.size} onSize={handleSize} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
