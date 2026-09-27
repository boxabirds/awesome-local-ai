// Story 9: one free text object (anchor: text.object): render, select, move,
// double-click to edit, and the size toolbar hooks (via SelectionBar).
//
// Selection, move, nudge, delete, marquee and undo come unchanged from
// stories 7 and 8 through the registry (text.consistent). The object renders
// its stored box (width/height) so remote clients never re-measure; only the
// client that made a local change writes a new box (text.layout, key
// decision 1).

import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  getTextContent,
  type TextSnapshot,
} from '../../shared/objects/text';
import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
} from '../../shared/config';
import { sharedMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';

export function TextObject(props: ObjectProps & { note?: TextSnapshot }): JSX.Element {
  const { obj, selected, editing } = props;
  const note = props.note ?? (obj as TextSnapshot);
  const undo = useUndoController();
  const { remeasureAfterLocalChange } = useTextBoxSync(props.doc, obj.id, sharedMeasurer());

  // --- pointer: hand to the shared transform gesture (sel.transform) --------
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (editing) return; // the textarea owns pointer events while editing
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); // the board must not pan/marquee/create on a text press
    props.onPointerDown(e);
  };

  // --- keyboard and edit ----------------------------------------------------
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (!editing && props.canEdit) props.onStartEdit(obj.id);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' && !editing && props.canEdit) {
      e.preventDefault();
      props.onStartEdit(obj.id);
    }
  };

  const ytext = getTextContent(props.doc, obj.id);
  const fontPx = TEXT_SIZES[note.size] ?? TEXT_SIZES.M;

  return (
    <div
      className="text-object"
      data-testid="text-object"
      data-text-id={obj.id}
      data-selected={selected ? '' : undefined}
      role="group"
      aria-label={note.text !== '' ? note.text : 'Text object'}
      tabIndex={0}
      style={{
        left: obj.x,
        top: obj.y,
        width: obj.width ?? 'auto',
        height: obj.height ?? 'auto',
        fontSize: fontPx,
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: TEXT_LINE_HEIGHT,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={typeof obj.width === 'number' ? obj.width : 'auto'}
          ariaLabel="Text object text"
          undo={undo}
          onInput={remeasureAfterLocalChange}
          onEnd={() => props.onEndEdit(obj.id)}
        />
      ) : (
        <div className="text-object__content">{note.text}</div>
      )}
    </div>
  );
}
