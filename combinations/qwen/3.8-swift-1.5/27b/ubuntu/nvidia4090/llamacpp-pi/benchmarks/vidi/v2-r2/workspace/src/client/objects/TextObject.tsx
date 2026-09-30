import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { getTextContent, deleteIfEmpty, type TextSnapshot } from '../../shared/objects/text';
import {
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
} from '../../shared/config';
import type { ObjectProps } from './registry';
import { createCanvasMeasurer } from './textLayout';
import { TEXT_BOX_PADDING } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';

/**
 * Free text object (story 9). Plain text with no background, placed anywhere
 * on the board. The saved width/height is the measured box (written by
 * useTextBoxSync on local changes). Double-click or Enter starts editing;
 * ending an edit on empty text deletes the object.
 */
export function TextObject(props: ObjectProps & { note?: TextSnapshot }): ReactElement {
  const {
    obj,
    doc,
    z,
    selected,
    editing,
    editable,
    onPointerDown,
    onStartEdit,
    onEndEdit,
    boundary,
    undoController,
  } = props;
  const note = props.note ?? (obj as TextSnapshot);

  const measure = useMemo(() => createCanvasMeasurer(), []);
  const sync = useTextBoxSync(doc, note.id, measure);
  const ytext = getTextContent(doc, note.id);

  const handleEndEdit = (_next: 'selected' | 'unselected') => {
    // Remove the object if it is empty (zero characters); no-op otherwise
    // (including when it was already deleted remotely). The selection is
    // pruned by useSelection when the object disappears.
    deleteIfEmpty(doc, note.id);
    onEndEdit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && editable && !editing) {
      e.preventDefault();
      onStartEdit(note.id);
    }
  };

  const fontPx = TEXT_SIZES[note.size] ?? TEXT_SIZES.M;

  return (
    <div
      data-testid="text-object"
      data-text-id={note.id}
      data-selected={selected || undefined}
      role="group"
      aria-label={note.text || 'Text'}
      tabIndex={editing ? -1 : 0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        fontSize: fontPx,
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: TEXT_LINE_HEIGHT,
        color: '#111827',
        outline: 'none',
        cursor: editing ? 'text' : 'default',
        zIndex: z,
      }}
      onPointerDown={(e) => onPointerDown(e, note.id)}
      onDoubleClick={(e) => {
        if (editable && !editing) {
          e.stopPropagation();
          onStartEdit(note.id);
        }
      }}
      onKeyDown={handleKeyDown}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          fontPx={fontPx}
          padding={TEXT_BOX_PADDING}
          lineHeight={TEXT_LINE_HEIGHT}
          onInput={() => sync.remeasureAfterLocalChange()}
          onEnd={handleEndEdit}
          boundary={boundary}
          undoController={undoController}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            padding: `0 ${TEXT_BOX_PADDING}px`,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}
