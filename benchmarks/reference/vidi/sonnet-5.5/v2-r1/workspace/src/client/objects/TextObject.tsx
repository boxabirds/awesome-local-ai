import { objectBounds } from '../../shared/board-model';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import { deleteIfEmpty, getTextContent, isEmptyText } from '../../shared/objects/text';
import type { TextSnapshot } from '../../shared/objects/text';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { getDefaultMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';

/** Extra width the editing textarea gets in automatic mode so the line being typed never wraps early. */
const EDITOR_SLACK_WORLD = 8;

export function TextObject(props: ObjectProps) {
  const { doc, selected, editing } = props;
  const note = props.object as TextSnapshot;
  const { width, height } = objectBounds(note);
  const undo = useUndoController();
  const sync = useTextBoxSync(doc, note.id, getDefaultMeasurer());
  const fontPx = TEXT_SIZES[note.size];
  const ytext = editing && !props.readOnly ? getTextContent(doc, note.id) : undefined;

  const end = (next: 'selected' | 'unselected') => {
    if (isEmptyText(doc, note.id)) {
      // An empty text never stays behind as an invisible object, nor as an undo step.
      if (deleteIfEmpty(doc, note.id)) undo?.popLast?.();
      props.onEndEdit('unselected');
      return;
    }
    props.onEndEdit(next);
  };

  return (
    <div
      role="group"
      aria-label={note.text || 'Empty text'}
      data-text-object=""
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      tabIndex={0}
      className={`text-object${selected ? ' text-object--selected' : ''}`}
      style={{
        left: note.x,
        top: note.y,
        width,
        height,
        zIndex: note.z,
        fontSize: fontPx,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: TEXT_FONT_FAMILY,
        cursor: editing ? 'text' : 'pointer',
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0 || editing) return;
        props.onObjectPointerDown(e, note.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!props.readOnly) props.onStartEdit(note.id);
      }}
    >
      <div className="text-object-content" data-testid="text-content" style={{ visibility: ytext ? 'hidden' : 'visible' }}>
        {note.text}
      </div>
      {ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={note.widthMode === 'fixed' ? width : width + EDITOR_SLACK_WORLD}
          onInput={sync.remeasureAfterLocalChange}
          onEnd={end}
          undo={undo}
          className="text-editor"
          ariaLabel="Text"
          containerSelector="[data-text-object]"
          style={{ fontFamily: TEXT_FONT_FAMILY, lineHeight: TEXT_LINE_HEIGHT }}
        />
      )}
    </div>
  );
}
