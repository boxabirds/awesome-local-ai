import { useEffect, useRef } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import {
  deleteIfEmpty,
  getTextContent,
  setTextSize,
  type TextSnapshot,
} from '../../shared/objects/text';
import { deleteObjects } from '../../shared/board-model';
import {
  TEXT_FONT_FAMILY,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  type TextSize,
} from '../../shared/config';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import { useTextBoxSync } from './useTextBoxSync';
import type { Measurer } from './textLayout';
import { TEXT_MAX_CHARS } from '../../shared/config';

export interface TextObjectProps {
  /** Plain data for this text object. */
  note: TextSnapshot;
  /** The shared document. */
  doc: Y.Doc;
  /** Camera zoom. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Whether the board is editable. */
  canEdit: boolean;
  /** Pointer down delegates to the transform gesture. */
  onPointerDown?(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** If true, this text is part of a multi-selection. */
  multiSelected?: boolean;
  /** If true, this text is being dragged. */
  dragging?: boolean;
  /** Called on edit start/end to close undo capture windows. */
  undoBoundary?(): void;
  /** Undo controller for Ctrl+Z inside the editor. */
  undoCtrl?: { undo(): boolean; redo(): boolean };
  /** The text measurer for layout. */
  measure: Measurer;
}

/**
 * Renders a text object on the board: plain text, no background, with stored
 * width/height, `white-space: pre-wrap`, and the appropriate font size.
 */
export function TextObject({
  note,
  doc,
  zoom,
  selected,
  editing,
  canEdit,
  onPointerDown,
  onSelect,
  onStartEdit,
  onEndEdit,
  multiSelected,
  dragging,
  undoBoundary,
  undoCtrl,
  measure,
}: TextObjectProps): JSX.Element {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;

  const width = note.width ?? 100;
  const height = note.height ?? TEXT_SIZES[note.size] * TEXT_LINE_HEIGHT;
  const fontPx = TEXT_SIZES[note.size];

  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, measure);

  // Handle ending editing: check if text is empty and remove
  const handleEndEdit = (next: 'selected' | 'unselected'): void => {
    // Check for empty text — if zero chars, delete the object
    if (canEdit) {
      const wasDeleted = deleteIfEmpty(doc, note.id);
      if (wasDeleted) {
        // Object was removed; clear selection
        onEndEditRef.current('unselected');
        return;
      }
    }
    onEndEditRef.current(next);
  };

  const handleEndEditRef = useRef(handleEndEdit);
  handleEndEditRef.current = handleEndEdit;

  // A press outside the text ends editing.
  useEffect(() => {
    if (!editing) return undefined;
    const handleDocumentPointerDown = (event: PointerEvent): void => {
      const element = elementRef.current;
      if (
        element !== null &&
        event.target instanceof Node &&
        element.contains(event.target)
      ) {
        return;
      }
      handleEndEditRef.current('unselected');
    };
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  }, [editing]);

  // If the object is deleted remotely while editing, end editing silently.
  // (The parent component won't render us anymore because the snapshot is gone.)

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (editing) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    if (event.shiftKey) {
      onSelect(note.id);
      return;
    }

    if (onPointerDown) {
      onPointerDown(event, note.id);
    }
  };

  const handleDoubleClick = (
    event: ReactMouseEvent<HTMLDivElement> | ReactPointerEvent<HTMLDivElement>,
  ): void => {
    event.stopPropagation();
    if (editing || !canEdit) return;
    // Select first, then start editing
    onSelect(note.id);
    onStartEdit(note.id);
  };

  const ytext = editing ? getTextContent(doc, note.id) : undefined;

  return (
    <div
      ref={elementRef}
      className="text-object"
      data-testid="text-object"
      data-text-id={note.id}
      data-text-x={note.x}
      data-text-y={note.y}
      data-text-width={width}
      data-text-height={height}
      data-text-size={note.size}
      data-text-mode={note.widthMode}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={note.text || 'Empty text'}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        zIndex: note.z,
        cursor: editing ? 'text' : 'grab',
        userSelect: editing ? 'text' : 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={note.widthMode === 'fixed' ? width : 'auto'}
          onInput={remeasureAfterLocalChange}
          onEnd={handleEndEdit}
          undoBoundary={undoBoundary}
          undoCtrl={undoCtrl}
        />
      ) : (
        <div
          className="text-object__content"
          data-testid="text-content"
          style={{
            fontSize: `${fontPx}px`,
            fontFamily: TEXT_FONT_FAMILY,
            lineHeight: TEXT_LINE_HEIGHT,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            width: '100%',
            overflow: 'hidden',
          }}
        >
          {note.text}
        </div>
      )}

      {/* Text toolbar: shown when exactly one text is selected, not editing, not dragging */}
      {selected && !editing && !multiSelected && !dragging ? (
        <div
          className="text-object__toolbar-anchor"
          data-testid="text-toolbar-anchor"
          style={{ transform: `scale(${1 / (zoom || 1)})` }}
        >
          <TextToolbar
            size={note.size}
            onSize={(s: TextSize) => {
              setTextSize(doc, note.id, s);
              remeasureAfterLocalChange();
            }}
            onDelete={() => {
              deleteObjects(doc, [note.id]);
              onEndEditRef.current('unselected');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
