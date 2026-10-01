import type { PointerEvent as ReactPointerEvent } from 'react';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import { deleteIfEmpty, getTextContent, type TextSnapshot } from '../../shared/objects/text';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { defaultMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';

export function TextObject(props: ObjectProps & { note?: TextSnapshot }) {
  const { object, doc, selected, editing, editable } = props;
  const note = (props.note ?? object) as TextSnapshot;
  const undo = useUndoController();
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, defaultMeasurer());
  const fontPx = TEXT_SIZES[note.size];

  const ytext = editing ? getTextContent(doc, note.id) : undefined;
  const showEditor = editing && ytext !== undefined;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
    props.onObjectPointerDown(e, note.id);
  };

  // Ending an edit with no characters removes the object in the same undo step as the typing.
  const onEnd = (next: 'selected' | 'unselected') => {
    if (deleteIfEmpty(doc, note.id)) props.onEndEdit('unselected');
    else props.onEndEdit(next);
  };

  return (
    <div
      role="group"
      aria-label={note.text === '' ? 'Text' : `Text: ${note.text}`}
      tabIndex={0}
      data-selected={selected ? 'true' : 'false'}
      data-text-id={note.id}
      data-object-id={note.id}
      data-z={note.z}
      data-width-mode={note.widthMode}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable) props.onStartEdit(note.id);
      }}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        zIndex: note.z,
        boxSizing: 'border-box',
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: fontPx,
        lineHeight: TEXT_LINE_HEIGHT,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        color: '#222',
        outline: 'none',
        cursor: editing ? 'text' : 'grab',
        touchAction: 'none',
        userSelect: editing ? 'text' : 'none',
      }}
    >
      <div data-testid="text-content" style={{ visibility: editing ? 'hidden' : 'visible', pointerEvents: 'none' }}>
        {note.text}
      </div>
      {showEditor && (
        <div style={{ position: 'absolute', left: 0, top: 0, minWidth: fontPx }}>
          <TextEditor
            ytext={ytext}
            maxChars={TEXT_MAX_CHARS}
            fontPx={fontPx}
            width={Math.max(note.width, fontPx)}
            onInput={remeasureAfterLocalChange}
            onEnd={onEnd}
            undo={undo}
            ariaLabel="Text"
            lineHeight={TEXT_LINE_HEIGHT}
            textAlign="left"
            fontFamily={TEXT_FONT_FAMILY}
            continueCapture={ytext.length === 0}
          />
        </div>
      )}
    </div>
  );
}
