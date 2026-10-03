// A free text object (story 9). It is *only* a renderer and an editor host: selecting,
// moving, nudging, marquee-ing, resizing and deleting all come from stories 7 and 8
// through the registry, so a text object behaves exactly like every other object there
// (text.consistent) and this file adds no selection or transform code of its own.
//
// What is text-specific:
//  - it renders plain text (no fill, no background) at x/y in its *stored* box, with
//    `white-space: pre-wrap` and the font size its size preset says;
//  - double-click (or Enter on a single selection, which the board keyboard already
//    does generically for any type) opens the shared `TextEditor`;
//  - every local edit re-measures and stores the box (`useTextBoxSync`), and so does a
//    local change to `size` or `width` (a TextToolbar size pick, or a side-handle drag)
//    — never a remote change, whose author already wrote the measured box (Key decision 1);
//  - ending an edit with zero characters removes the object, so no invisible text is
//    ever left on the board (text.empty_removed). The delete rides the same capture
//    window as the last edit, so one Ctrl+Z brings the text back.

import { useCallback, useEffect, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  type TextSnapshot,
} from '../../shared/board-model';
import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
} from '../../shared/config';
import {
  deleteIfEmpty,
  getTextContent,
} from '../../shared/objects/text';
import type { ObjectProps } from './registry';
import { useUndoController } from '../board/useUndo';
import { TextEditor } from './TextEditor';
import { useTextMeasurer } from './textMeasurer';
import { useTextBoxSync } from './useTextBoxSync';

export type TextObjectProps = ObjectProps;

export function TextObject(props: TextObjectProps) {
  const {
    doc,
    selected,
    editing,
    canEdit,
    onObjectPointerDown,
    onStartEdit,
    onEndEdit,
  } = props;
  const obj = props.obj as TextSnapshot;

  // This tab's undo controller (may be absent, e.g. a board that failed to load).
  const undo = useUndoController();

  // This tab's measurer: a real canvas where there is one, the character-count
  // estimate where there is none (jsdom), or whatever a test injected.
  const measure = useTextMeasurer();
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, obj.id, measure);

  // A local change to the size preset or to the width (a size pick, a side-handle
  // drag) re-measures the box. Watching the object's own Y.Map keys keeps that in one
  // place instead of teaching every caller about it; a remote origin is ignored, and
  // `setTextBox` writes only when the box actually differs, so this cannot loop.
  useEffect(() => {
    const map = doc.getMap<Y.Map<unknown>>('objects').get(obj.id);
    if (!map) return;
    const onLocal = (event: Y.YMapEvent<unknown>, tr: Y.Transaction): void => {
      if (tr.origin !== LOCAL_ORIGIN) return;
      if (event.keysChanged.has('size') || event.keysChanged.has('width')) {
        remeasureAfterLocalChange();
      }
    };
    map.observe(onLocal);
    return () => map.unobserve(onLocal);
  }, [doc, obj.id, remeasureAfterLocalChange]);

  const ytext = editing ? getTextContent(doc, obj.id) : undefined;

  // Leaving the edit: an object that ended up empty is removed and the selection
  // cleared; otherwise the object stays selected (text.object).
  const handleEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      if (deleteIfEmpty(doc, obj.id)) {
        onEndEdit('unselected');
        return;
      }
      onEndEdit(next);
    },
    [doc, obj.id, onEndEdit],
  );

  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!canEdit) return; // editing text is a board mutation
    if (!editing) onStartEdit(obj.id);
  };

  const fontPx = TEXT_SIZES[obj.size];

  // The rendered box is always the stored width / height, so selection bounds, the
  // marquee and any future export measure the same rectangle the DOM shows.
  const textStyle: CSSProperties = {
    fontFamily: TEXT_FONT_FAMILY,
    fontSize: fontPx,
    lineHeight: TEXT_LINE_HEIGHT,
    color: '#222',
    width: obj.width,
    minHeight: obj.height,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    boxSizing: 'border-box',
  };

  return (
    <div
      role="group"
      aria-label="Text"
      data-text-object-id={obj.id}
      data-object-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      data-testid={`text-object-${obj.id}`}
      tabIndex={0}
      className="text-object"
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        zIndex: obj.z,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={obj.width}
          undo={undo}
          testId="text-editor"
          ariaLabel="Text"
          className="text-object-editing"
          onInput={remeasureAfterLocalChange}
          onEnd={handleEnd}
        />
      ) : (
        <div data-testid={`text-content-${obj.id}`} style={textStyle}>
          {obj.text}
        </div>
      )}
    </div>
  );
}
