import { objectBounds } from '../../shared/board-model';
import {
  TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MAX_CHARS, TEXT_SIZES,
} from '../../shared/config';
import { deleteIfEmpty, getTextContent, type TextSnapshot } from '../../shared/objects/text';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { sharedMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';

const PRIMARY_BUTTON = 0;

export function TextObject(props: ObjectProps) {
  const { doc, zoom, selected, editing, dragging, readOnly } = props;
  const note = props.object as TextSnapshot;
  const { id } = note;
  const { width, height } = objectBounds({ ...note, width: note.width ?? 1, height: note.height ?? 1 });
  const fontPx = TEXT_SIZES[note.size];
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, sharedMeasurer());

  const end = (next: 'selected' | 'unselected') => {
    // Empty text never stays behind as an invisible object; the removal joins the last edit's undo step.
    if (deleteIfEmpty(doc, id)) props.onEndEdit('unselected');
    else props.onEndEdit(next);
  };

  return (
    <div
      role="group"
      aria-label={note.text === '' ? 'Text' : note.text}
      tabIndex={0}
      data-text-object=""
      data-id={id}
      data-x={note.x}
      data-y={note.y}
      data-width={width}
      data-height={height}
      data-size={note.size}
      data-width-mode={note.widthMode}
      data-selected={selected}
      data-editing={editing}
      data-dragging={dragging}
      className="text-object"
      style={{
        left: note.x, top: note.y, zIndex: note.z, width, height,
        fontSize: fontPx, fontFamily: TEXT_FONT_FAMILY, lineHeight: TEXT_LINE_HEIGHT,
        cursor: dragging ? 'grabbing' : editing ? 'text' : 'pointer',
        outline: selected && !editing ? `${1 / zoom}px dashed #2563eb` : 'none',
      }}
      onPointerDown={(e) => {
        if (editing || (e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
        e.stopPropagation();
        props.onPointerDown(e, id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!readOnly) props.onStartEdit(id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget && !editing && !readOnly) {
          e.preventDefault();
          e.stopPropagation();
          props.onStartEdit(id);
        }
      }}
    >
      <div className="text-object-content" style={{ visibility: editing ? 'hidden' : 'visible' }}>{note.text}</div>
      {editing && !readOnly && (
        <TextEditorHost {...props} wrap={width >= TEXT_MAX_AUTO_WIDTH_WORLD || note.widthMode === 'fixed'}
          onInput={remeasureAfterLocalChange} onEnd={end} fontPx={fontPx} />
      )}
    </div>
  );
}

function TextEditorHost(props: ObjectProps & {
  fontPx: number; wrap: boolean; onInput(): void; onEnd(next: 'selected' | 'unselected'): void;
}) {
  const ytext = getTextContent(props.doc, props.object.id);
  if (!ytext) return null; // deleted while editing: no write, no re-creation
  return (
    <TextEditor
      ytext={ytext}
      maxChars={TEXT_MAX_CHARS}
      fontPx={props.fontPx}
      width="auto"
      className="text-editor"
      ariaLabel="Text"
      style={{ whiteSpace: props.wrap ? 'pre-wrap' : 'pre' }}
      boundaryOnStart={ytext.length > 0}
      onInput={props.onInput}
      onEnd={props.onEnd}
      undo={props.undo}
    />
  );
}
