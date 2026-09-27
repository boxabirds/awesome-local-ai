// Text object rendering and editing (see spec: text.object).
//
// Absolutely positioned plain text (no fill) at x/y with the STORED
// width/height, white-space: pre-wrap, font TEXT_SIZES[size]. The stored box
// is written by useTextBoxSync after LOCAL changes (typing, size change,
// fixed-width drag) — remote clients render the stored box as-is.
//
// Editing is the story-2 editor generalised (TextEditor): caret at end,
// Enter newline, Escape/outside click ends, minimal Y.Text diff, clamped to
// TEXT_MAX_CHARS. Edit end removes empty text (deleteIfEmpty); selection,
// move, delete and undo are the generic registry operations (text.consistent).

import { useEffect, type JSX } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../../shared/board-model';
import { TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import type { TextSnapshot } from '../../shared/objects/text';
import { deleteIfEmpty, getTextContent, isEmptyText } from '../../shared/objects/text';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { useTextBoxSync } from './useTextBoxSync';

export function TextObject(props: ObjectProps): JSX.Element {
  const {
    obj,
    doc,
    selected,
    editing,
    editable,
    onObjectPointerDown,
    onFocusSelect,
    onStartEdit,
    onEndEdit,
    undo,
  } = props;
  const text = obj as ObjectSnapshot & TextSnapshot;
  const fontPx = TEXT_SIZES[text.size];
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, obj.id);

  // A LOCAL size change (TextToolbar) or fixed-width drag re-measures the
  // box in the same capture window (key decision 1). Remote changes never
  // re-measure (TC-12). The remeasure is a no-op write when the box is
  // unchanged, so re-measuring on any local map change (x/width/size/...
  // all of them) is safe and avoids depending on Yjs event-key enumeration.
  useEffect(() => {
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const object = objects.get(obj.id);
    if (object === undefined) return;
    const handler = (_event: Y.YEvent<Y.Map<unknown>>, transaction: Y.Transaction) => {
      if (transaction.origin !== LOCAL_ORIGIN) return;
      remeasureAfterLocalChange();
    };
    object.observe(handler);
    return () => object.unobserve(handler);
  }, [doc, obj.id, remeasureAfterLocalChange]);

  const handleEnd = (next: 'selected' | 'unselected') => {
    if (isEmptyText(doc, obj.id)) {
      // Empty text never becomes an invisible object (text.object): the
      // object is removed; the selection prunes the deleted id.
      undo?.boundary();
      deleteIfEmpty(doc, obj.id);
      undo?.boundary();
      onEndEdit(next);
    } else {
      onEndEdit(next);
    }
  };

  return (
    <div
      data-testid="text-object"
      data-id={obj.id}
      role="group"
      aria-label="Text"
      data-selected={selected || undefined}
      className="text-object"
      style={{
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        fontSize: fontPx,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable) onStartEdit(obj.id);
      }}
      onFocus={() => {
        if (!selected && !editing) onFocusSelect(obj.id);
      }}
      tabIndex={0}
    >
      {editing ? (
        <TextEditor
          ytext={getTextContent(doc, obj.id)!}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width="auto"
          onInput={remeasureAfterLocalChange}
          onEnd={handleEnd}
          undo={undo}
          ariaLabel="Text"
          wrapperTestId="text-editor"
        />
      ) : (
        <div
          data-testid="text-content"
          className="text-object-content"
          style={{ fontSize: fontPx }}
        >
          {text.text}
        </div>
      )}
    </div>
  );
}
