import { useMemo } from 'react';
import type { TextSnapshot } from '../../shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import { deleteIfEmpty, getTextContent } from '../../shared/objects/text';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { defaultMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';

export function TextObject(props: ObjectProps) {
  const note = props.object as TextSnapshot;
  const { doc, selected, editing, dragging, readOnly, onEndEdit } = props;
  const undo = useUndoController();
  const measure = useMemo(defaultMeasurer, []);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, measure);
  const fontPx = TEXT_SIZES[note.size];

  const startEdit = () => { if (!readOnly) props.onStartEdit(note.id); };
  const end = (next: 'selected' | 'unselected') => {
    const ytext = getTextContent(doc, note.id);
    if (!ytext) {
      onEndEdit('unselected');
      return;
    }
    // Empty text never stays behind as an invisible object.
    if (deleteIfEmpty(doc, note.id)) {
      onEndEdit('unselected');
      return;
    }
    onEndEdit(next);
  };

  return (
    <div
      className="text-object"
      data-text-object=""
      data-object-id={note.id}
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-width-mode={note.widthMode}
      role="group"
      aria-label={note.text === '' ? 'Text' : note.text}
      tabIndex={0}
      style={{
        left: note.x, top: note.y, width: note.width, height: note.height, zIndex: note.z,
        fontSize: fontPx, lineHeight: TEXT_LINE_HEIGHT,
        cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={(e) => props.onObjectPointerDown(e, note.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        startEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget && !editing) {
          e.preventDefault();
          e.stopPropagation();
          startEdit();
        }
      }}
    >
      <div className="text-content" data-testid="text-content" style={{ visibility: editing ? 'hidden' : 'visible' }}>
        {note.text}
      </div>
      {editing && (() => {
        const ytext = getTextContent(doc, note.id);
        return ytext ? (
          <TextEditor
            ytext={ytext}
            maxChars={TEXT_MAX_CHARS}
            fontPx={fontPx}
            width={note.width}
            label="Text"
            className="text-editor"
            mergeFreshWithCreation
            onInput={remeasureAfterLocalChange}
            onEnd={end}
            undo={undo}
          />
        ) : null;
      })()}
    </div>
  );
}
