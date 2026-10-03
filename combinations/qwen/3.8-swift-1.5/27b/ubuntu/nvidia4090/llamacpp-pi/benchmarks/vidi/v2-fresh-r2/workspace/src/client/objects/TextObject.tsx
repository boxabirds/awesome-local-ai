/**
 * Free text object component (story 9, text.object / text.editing).
 *
 * Renders a text annotation at its persisted top-left (x, y) and measured
 * box (width, height) with NO background. The font size follows the size
 * preset. Double-click (or Enter when selected) starts editing; the editor
 * is the generalised TextEditor. On edit end, an empty (zero-character) text
 * object is removed (text.empty_removed).
 *
 * The box is kept in sync by useTextBoxSync: the local client measures and
 * writes width/height after its own changes; remote clients render the
 * stored box (text.layout).
 */

import { useCallback, useRef } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../shared/config';
import { deleteObjects } from '../../shared/board-model';
import {
  getTextContent,
  isEmptyText,
  type TextSnapshot,
} from '../../shared/objects/text';
import { TextEditor } from './TextEditor';
import { useTextBoxSync } from './useTextBoxSync';
import { resolveMeasurer } from './textLayout';
import type { ObjectProps } from './registry';

export function TextObject(props: ObjectProps & { note?: TextSnapshot }): JSX.Element {
  const {
    obj,
    doc,
    zoom,
    selected,
    editing,
    canEdit = true,
    onObjectPointerDown,
    onStartEdit,
    onEndEdit,
    undo,
  } = props;
  const note = props.note ?? (obj as TextSnapshot);
  const width = note.width ?? TEXT_MIN_WIDTH_WORLD;
  const height = note.height ?? TEXT_SIZES[note.size] * TEXT_LINE_HEIGHT;
  const fontPx = TEXT_SIZES[note.size];

  // The display reads the live Y.Text (the generic `objects()` snapshot does
  // not carry the text content for text objects, only the measured box).
  const content = getTextContent(doc, note.id)?.toString() ?? '';

  // Local-only box sync (the client that changes the text writes the box).
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, resolveMeasurer());

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // Prevent board panning
      if (editing) return; // Don't start a gesture while editing
      onObjectPointerDown(e, note.id);
    },
    [editing, note.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (canEdit && !editing) {
        onStartEdit(note.id);
      }
    },
    [note.id, editing, canEdit, onStartEdit],
  );

  // End editing: an empty (zero-character) text object is removed and the
  // selection drops (text.empty_removed).
  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      if (isEmptyText(doc, note.id)) {
        deleteObjects(doc, [note.id]);
        onEndEdit('unselected');
      } else {
        onEndEdit(next);
      }
    },
    [doc, note.id, onEndEdit],
  );

  return (
    <div
      role="group"
      aria-label={content || 'Text'}
      data-testid="text-object"
      data-note-id={note.id}
      data-selected={selected || undefined}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: `${fontPx}px`,
        lineHeight: TEXT_LINE_HEIGHT,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        color: '#333',
        cursor: editing ? 'text' : 'grab',
        outline: 'none',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
    >
      {editing ? (
        <TextEditor
          ytext={getTextContent(doc, note.id)!}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width="auto"
          ariaLabel="Text"
          onInput={remeasureAfterLocalChange}
          onEnd={handleEndEdit}
          undo={undo}
        />
      ) : (
        <div
          data-testid="text-display"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
