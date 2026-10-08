// TextObject (story 9, text.object): renders a free text object and its
// in-place editor. No background and no border (text.object); the text is
// rendered at the object's size preset and wraps within its stored box.
//
// Same object behaviour as story 2's sticky notes: click to select,
// double-click (or Enter while selected) to edit, drag to move, and the
// horizontal handles of the selection box set a fixed width (story 9 adds
// the width; sticky notes keep their eight handles and their colour).
//
// Finishing editing with an empty text removes the object (text.remove_empty);
// whitespace-only text is kept.

import { useMemo, type JSX } from 'react';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_FONT_FAMILY,
  TEXT_INITIAL_HEIGHT_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';
import {
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  isTextSize,
  type TextSnapshot,
} from '../../shared/objects/text';
import { createCanvasMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

export interface TextObjectProps extends ObjectProps {
  /** The object's snapshot as a text object (defaults to obj, validated). */
  note?: TextSnapshot;
}

export function TextObject(props: TextObjectProps): JSX.Element {
  const { obj, doc, selected, editing, canEdit, onPointerDown, onStartEdit, onEndEdit, undo } =
    props;

  const snap: TextSnapshot = props.note ?? (obj as TextSnapshot);
  const size: TextSize = isTextSize(snap.size) ? snap.size : DEFAULT_TEXT_SIZE;
  const width = obj.width ?? TEXT_MIN_WIDTH_WORLD;
  const height = obj.height ?? TEXT_INITIAL_HEIGHT_WORLD;
  const fontPx = TEXT_SIZES[size];

  const ytext = getTextContent(doc, obj.id);
  const measure = useMemo(() => createCanvasMeasurer(), []);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, obj.id, measure);

  // A text object must never pan the board (sticky.no_pan behaviour, shared):
  // stop propagation and delegate to the generic transform gesture.
  const onPointerDownHandler = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (editing) return; // the textarea owns the pointer while editing
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore: best-effort (jsdom).
      }
    }
    onPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (editing || !canEdit) return;
    e.stopPropagation();
    onStartEdit(obj.id);
  };

  // Finishing an empty edit removes the object (text.remove_empty).
  const handleEnd = (next: 'selected' | 'unselected') => {
    if (isEmptyText(doc, obj.id)) {
      undo?.boundary();
      deleteIfEmpty(doc, obj.id);
      undo?.boundary();
      // The object is gone; the selection prunes itself from the snapshot.
      onEndEdit('unselected');
      return;
    }
    onEndEdit(next);
  };

  return (
    <div
      className={`text-object${selected ? ' text-object--selected' : ''}`}
      data-testid="text-object"
      data-id={obj.id}
      role="group"
      aria-label={obj.text !== '' ? `Text: ${obj.text}` : 'Text'}
      tabIndex={0}
      data-selected={selected || undefined}
      onPointerDown={onPointerDownHandler}
      onDoubleClick={onDoubleClick}
      style={{
        left: obj.x,
        top: obj.y,
        width,
        height,
        zIndex: obj.z,
        fontSize: fontPx,
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: TEXT_LINE_HEIGHT,
      }}
    >
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={width}
          height={height}
          ariaLabel="Text"
          onInput={remeasureAfterLocalChange}
          onEnd={handleEnd}
          undo={undo}
        />
      ) : (
        obj.text
      )}
    </div>
  );
}
