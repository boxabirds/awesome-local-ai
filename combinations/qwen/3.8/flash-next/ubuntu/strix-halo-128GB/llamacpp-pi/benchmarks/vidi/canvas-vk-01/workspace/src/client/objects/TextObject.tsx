import {
  useEffect,
  useMemo,
  useRef,
  type JSX,
} from 'react';
import type * as Y from 'yjs';
import {
  TEXT_FONT_FAMILY,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
} from '../../shared/config';
import { getTextContent, isEmptyText, deleteIfEmpty, type TextSnapshot } from '../../shared/objects/text';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { createCanvasMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';

/**
 * One measurer per client: canvas where it exists, the documented estimate
 * where it does not. Stable identity, so hook dependencies do not churn.
 */
const sharedMeasurer = createCanvasMeasurer(TEXT_FONT_FAMILY);

/**
 * A free text object on the board (story 9): plain text, no background, the
 * box sized by the layout. Selection, move, resize handles and delete are all
 * generic; this component renders, hosts the shared editor, keeps its own
 * box measured after local edits, and deletes itself when it ends up empty.
 */
export function TextObject(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, editable, onStartEdit, onEndEdit, onObjectPointerDown } =
    props;
  const note = obj as TextSnapshot;

  const objectsMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, sharedMeasurer);

  // Editing an object that disappears (remote delete) must not leave a
  // dangling editor.
  useEffect(() => {
    if (!objectsMap.has(note.id) && editing) onEndEdit('unselected');
  }, [note.id, objectsMap, editing, onEndEdit]);

  // An edit that ends with no characters removes the object (create, type
  // nothing, leave) — undo brings it back together with its creation.
  const wasEditingRef = useRef(false);
  useEffect(() => {
    if (wasEditingRef.current && !editing && objectsMap.has(note.id) && isEmptyText(doc, note.id)) {
      deleteIfEmpty(doc, note.id);
    }
    wasEditingRef.current = editing;
  }, [editing, doc, note.id, objectsMap]);

  const ytext = editing ? getTextContent(doc, note.id) : undefined;
  const fontPx = TEXT_SIZES[note.size] ?? TEXT_SIZES.M;

  const handleEnd = useMemo(
    () => (next: 'selected' | 'unselected') => {
      if (objectsMap.has(note.id) && isEmptyText(doc, note.id)) {
        deleteIfEmpty(doc, note.id);
        onEndEdit('unselected');
        return;
      }
      onEndEdit(next);
    },
    [doc, note.id, objectsMap, onEndEdit],
  );

  return (
    <div
      role="group"
      aria-label={note.text.length > 0 ? `Text: ${note.text}` : 'Text'}
      data-testid={`text-object-${note.id}`}
      data-text-id={note.id}
      data-selected={selected ? 'true' : undefined}
      className="text-object"
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${obj.width ?? 0}px`,
        height: `${obj.height ?? 0}px`,
        zIndex: obj.z,
        cursor: editing ? 'text' : 'default',
        fontFamily: TEXT_FONT_FAMILY,
      }}
      onPointerDown={(event) => onObjectPointerDown(event, note.id)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (!editable) return;
        if (!objectsMap.has(note.id)) return;
        onStartEdit(note.id);
      }}
      tabIndex={0}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={obj.width ?? 0}
          onInput={remeasureAfterLocalChange}
          onEnd={handleEnd}
          containerClassName="text-object-editor"
          containerTestId={`text-editor-${note.id}`}
          textareaClassName="text-object-textarea"
          textareaTestId={`text-textarea-${note.id}`}
        />
      ) : (
        <div
          className="text-object-content"
          data-testid={`text-content-${note.id}`}
          style={{ fontSize: `${fontPx}px` }}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}

export { sharedMeasurer as textMeasurer };
