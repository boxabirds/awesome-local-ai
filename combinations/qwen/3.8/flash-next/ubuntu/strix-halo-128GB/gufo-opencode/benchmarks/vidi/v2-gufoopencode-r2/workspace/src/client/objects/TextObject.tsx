// One free-text object in the world layer: plain text at x/y with the
// measured box, selection/drag through the shared gesture, editing through
// TextEditor, and box re-measure on local changes. Remote deletion while
// editing simply unmounts (the selection layer prunes the dead id).

import { useCallback, useMemo } from 'react';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../shared/config';
import { getTextContent, deleteIfEmpty, type TextSnapshot } from '../../shared/objects/text';
import { createLazyMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

// Story 6's design lists `note: TextSnapshot` in the props; like StickyNote
// we derive it from `obj` so the registry's ComponentType<ObjectProps> holds.

export type TextObjectProps = ObjectProps;

export function TextObject({
  obj,
  doc,
  selected,
  editing,
  editable,
  undo,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: TextObjectProps): React.JSX.Element {
  const note = obj as TextSnapshot;
  const width = note.width ?? TEXT_MIN_WIDTH_WORLD;
  const height = note.height ?? TEXT_SIZES[note.size] * TEXT_LINE_HEIGHT;
  const measure = useMemo(() => createLazyMeasurer(TEXT_FONT_FAMILY), []);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, measure);
  const ytext = editing ? getTextContent(doc, note.id) : undefined;

  // An edit that ends on an empty object deletes it (text.edit_end); the rest
  // of the flow is the shared selection behaviour.
  const handleEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      if (deleteIfEmpty(doc, note.id)) {
        onEndEdit('unselected');
        return;
      }
      onEndEdit(next);
    },
    [doc, note.id, onEndEdit],
  );

  return (
    <div
      role="group"
      aria-label={note.text === '' ? 'Text' : note.text}
      data-testid="text-object"
      data-text-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      className="text-object"
      tabIndex={0}
      style={
        {
          left: note.x,
          top: note.y,
          width,
          height,
          fontSize: TEXT_SIZES[note.size],
          lineHeight: TEXT_LINE_HEIGHT,
          zIndex: note.z,
        } as React.CSSProperties
      }
      onPointerDown={(e) => {
        if (editing) return; // caret placement inside the textarea stays with the editor
        if (!editable) return; // load_failed: no drag (the board pans behind instead)
        e.stopPropagation();
        onObjectPointerDown(e, note.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing && editable) onStartEdit(note.id);
      }}
    >
      {editing && editable ? (
        ytext ? (
          <TextEditor
            ytext={ytext}
            maxChars={TEXT_MAX_CHARS}
            fontPx={TEXT_SIZES[note.size]}
            width={note.widthMode === 'fixed' ? width : 'auto'}
            onInput={remeasureAfterLocalChange}
            onEnd={handleEnd}
            undo={undo}
          />
        ) : null
      ) : (
        <div className="text-object-content" data-testid="text-content">
          {note.text}
        </div>
      )}
    </div>
  );
}
