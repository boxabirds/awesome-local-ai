/**
 * Free text object (story 9): plain text with no background, placed anywhere on
 * the board. Selection, moving, nudging, deleting and undo come from the
 * generic board code via the registry; this component adds rendering, editing
 * and the box measurement that follows the content.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  deleteIfEmpty,
  getTextContent,
  textLineHeightWorld,
} from '../../shared/objects/text';
import type { TextSnapshot } from '../../shared/objects/text';
import { getObjectsMap } from '../../shared/board-model';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../shared/config';
import { TextEditor } from './TextEditor';
import { useTextBoxSync } from './useTextBoxSync';
import { getSharedMeasurer } from './textLayout';
import type { Measurer } from './textLayout';
import type { ObjectComponentProps } from './registry';

export interface TextObjectProps extends ObjectComponentProps {
  note: TextSnapshot;
  /** Injectable measurer (tests use a deterministic fake). */
  measure?: Measurer;
}

export function TextObject({
  note,
  doc,
  selected,
  editing,
  dragging = false,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  editable = true,
  undoController,
  measure,
}: TextObjectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const measurer = measure ?? getSharedMeasurer();
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, measurer);

  const width = note.width ?? TEXT_MIN_WIDTH_WORLD;
  const height = note.height ?? textLineHeightWorld(note.size);
  const fontPx = TEXT_SIZES[note.size] ?? TEXT_SIZES.M;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // The board must never pan because a press started on text.
      e.stopPropagation();
      // While editing, a press inside the text belongs to the caret.
      if (editing) return;
      if (!editable) return;
      onObjectPointerDown?.(e, note.id);
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

  // Focus returns to the text when editing ends, so Delete still works.
  useEffect(() => {
    if (selected && !editing) rootRef.current?.focus({ preventScroll: true });
  }, [selected, editing]);

  const exists = () => getObjectsMap(doc).has(note.id);

  /**
   * Editing finished. If the object vanished remotely, end quietly; if it holds
   * no characters, remove it so no invisible text is left behind (in the same
   * undo window as the last edit, so one undo restores it).
   */
  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      if (!exists()) {
        onEndEdit(next);
        return;
      }
      undoController?.boundary();
      const removed = deleteIfEmpty(doc, note.id);
      undoController?.boundary();
      onEndEdit(removed ? 'unselected' : next);
    },
    [doc, note.id, onEndEdit, undoController],
  );

  const ytext = editing ? getTextContent(doc, note.id) : undefined;

  return (
    <div
      ref={rootRef}
      data-text-id={note.id}
      data-object-id={note.id}
      data-testid="text-object"
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={note.text.length > 0 ? note.text : 'Text'}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        boxSizing: 'border-box',
        outline: selected ? '2px solid #1976D2' : 'none',
        cursor: editing ? 'text' : 'grab',
        touchAction: 'none',
        userSelect: editing ? 'text' : 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        data-testid="text-object-text"
        style={{
          width: '100%',
          color: '#1f1f1f',
          fontFamily: TEXT_FONT_FAMILY,
          fontSize: fontPx,
          lineHeight: TEXT_LINE_HEIGHT,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          pointerEvents: 'none',
          opacity: editing ? 0 : 1,
        }}
      >
        {note.text}
      </div>
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={width}
          onInput={remeasureAfterLocalChange}
          onEnd={handleEndEdit}
          undo={undoController}
          testId="text-editor"
          fontFamily={TEXT_FONT_FAMILY}
          lineHeight={TEXT_LINE_HEIGHT}
        />
      )}
    </div>
  );
}
