import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { TEXT_SIZES, TEXT_FONT_FAMILY, TEXT_MAX_CHARS } from '../../shared/config';
import { getTextContent, deleteIfEmpty, type TextSnapshot } from '../../shared/objects/text';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import { useTextBoxSync } from './useTextBoxSync';
import { createCanvasMeasurer } from './textLayout';
import type { UndoController } from '../board/undo';

const measurer = createCanvasMeasurer(TEXT_FONT_FAMILY);

export interface TextObjectProps {
  note: TextSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onDelete?(id: string): void;
  onObjectPointerDown?(e: React.PointerEvent, id: string): void;
  undoController?: UndoController;
  boundary?: () => void;
  canEdit?: boolean;
  onSizeChange?(id: string, size: string): void;
}

/**
 * Renders a text object: plain text, no background, positioned at x/y with stored width/height.
 * Handles editing, toolbar, and empty-text-on-end removal.
 */
export function TextObject({
  note,
  doc,
  zoom: _zoom,
  selected,
  editing,
  onSelect,
  onToggle,
  onStartEdit,
  onEndEdit,
  onDelete,
  onObjectPointerDown,
  undoController,
  boundary,
  canEdit = true,
  onSizeChange,
}: TextObjectProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, measurer);

  const width = note.width ?? 40;
  const height = note.height ?? 26;
  const fontPx = TEXT_SIZES[note.size];

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    event.stopPropagation();
    if (editing) return;

    if (event.shiftKey) {
      onToggle(note.id);
      return;
    }

    if (onObjectPointerDown) {
      onObjectPointerDown(event, note.id);
    } else {
      onSelect(note.id);
    }
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (editing || !canEdit) return;
    onSelect(note.id);
    onStartEdit(note.id);
  };

  // While editing, pointerdown outside ends editing
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (event: PointerEvent) => {
      const element = elementRef.current;
      if (element && event.target instanceof Node && element.contains(event.target)) return;
      handleEditEnd();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditEnd = (): void => {
    // Check if object still exists (may have been deleted remotely)
    const ytext = getTextContent(doc, note.id);
    if (!ytext) {
      // Object deleted remotely, just end editing
      onEndEdit('unselected');
      return;
    }
    // Delete if empty
    if (ytext.toString().length === 0) {
      deleteIfEmpty(doc, note.id);
      onEndEdit('unselected');
      return;
    }
    onEndEdit('selected');
  };

  const handleInput = useCallback((): void => {
    remeasureAfterLocalChange();
  }, [remeasureAfterLocalChange]);

  const ytext = editing ? getTextContent(doc, note.id) : undefined;

  // If editing but object has been deleted remotely, end editing
  useEffect(() => {
    if (editing && !ytext) {
      onEndEdit('unselected');
    }
  }, [editing, ytext, onEndEdit]);

  return (
    <div
      ref={elementRef}
      className="text-object"
      data-testid="text-object"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label={note.text || 'Text'}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${width}px`,
        minHeight: `${height}px`,
        zIndex: note.z,
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: `${fontPx}px`,
        lineHeight: 1.3,
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        cursor: editing ? 'text' : 'default',
        outline: selected ? '2px solid #1976D2' : 'none',
        outlineOffset: 2,
        padding: 0,
        margin: 0,
        background: 'transparent',
        border: 'none',
        color: '#1a1a1a',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={note.widthMode === 'fixed' ? width : 'auto'}
          onInput={handleInput}
          onEnd={handleEditEnd}
          undoController={undoController}
        />
      ) : (
        <span data-testid="text-content">{note.text}</span>
      )}
      {selected && !editing && (
        <TextToolbar
          size={note.size}
          onSize={(s) => {
            if (boundary) boundary();
            if (onSizeChange) onSizeChange(note.id, s);
            if (boundary) boundary();
          }}
          onDelete={() => {
            if (boundary) boundary();
            onDelete?.(note.id);
            if (boundary) boundary();
          }}
        />
      )}
    </div>
  );
}
