// Plain text with nothing behind it, anywhere on the board (`text_ui`,
// `text.editing`, `text.wrap`).
//
// A text object is a *box with words in it* and that is all: no colour, no paper,
// no shadow, no auto-fitting the characters down so they fit — the size you pick is
// the size it is. Two things about it look odd at first and are the point:
//
//   - **Its box is wider than its words, and the box is the move handle.** An empty
//     or short piece of text still has to be reachable, and a handle that only
//     appears over a glyph is not one. The box is what you grab; the words are
//     drawn inside it (`text.move`).
//
//   - **Nothing but this file's measuring writes its height.** The box is worked
//     out from the text — as wide as its longest line up to the board's limit, as
//     tall as the lines it wrapped into — and only the client that *made* the change
//     measures it (Key decision 1). What arrives from somewhere else is drawn with
//     the box it came with, never re-measured.
//
// An edit that ends with no characters in it throws the object away
// (`deleteIfEmpty`), and it goes before the undo step closes, so one Ctrl/Cmd+Z
// brings it back.
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type * as Y from 'yjs';
import { objectBounds } from '../../shared/board-model';
import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
} from '../../shared/config';
import {
  deleteIfEmpty,
  getTextContent,
  isTextSnapshot,
  type TextSnapshot,
} from '../../shared/objects/text';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { boardMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';

/** What a box with no characters in it says while you are typing in it. */
export const TEXT_PLACEHOLDER = 'Text';

/** A text object, reached through the registry like every other kind of object. */
export function TextObject(props: ObjectProps): ReactNode {
  if (!isTextSnapshot(props.object)) return null;
  return <TextBox {...props} object={props.object} />;
}

interface TextBoxProps extends ObjectProps {
  object: TextSnapshot;
}

function TextBox({
  object,
  doc,
  selected,
  editing,
  editable,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undo,
}: TextBoxProps): ReactNode {
  const bounds = objectBounds(object);
  // The box is this object's own business, and this is the only way it gets
  // written: after a local keystroke, never for a change that came from elsewhere.
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, object.id, boardMeasurer);

  const ytext: Y.Text | undefined = editing ? getTextContent(doc, object.id) : undefined;
  const empty = object.text.length === 0;
  const sizePx = TEXT_SIZES[object.size];

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editable || editing || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Selecting, raising and moving belong to the generic gesture.
    onObjectPointerDown(event.nativeEvent, object.id);
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!editable) return;
    event.stopPropagation();
    if (!editing) onStartEdit(object.id);
  };

  const boxStyle: CSSProperties = {
    position: 'absolute',
    left: object.x,
    top: object.y,
    width: bounds.width,
    height: bounds.height,
    boxSizing: 'border-box',
    // The box takes the pointer even where there are no glyphs to hit.
    pointerEvents: 'auto',
    cursor: 'grab',
    userSelect: editing ? 'text' : 'none',
    touchAction: 'none',
    color: '#1f2328',
  };

  const textStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    boxSizing: 'border-box',
    // Exactly the font the box was measured with, in board units: the world layer's
    // scale is what turns it into screen pixels.
    fontFamily: TEXT_FONT_FAMILY,
    fontSize: `${sizePx}px`,
    lineHeight: String(TEXT_LINE_HEIGHT),
    whiteSpace: 'pre-wrap',
    // A word too long for a line of its own breaks where the line ends — which is
    // the rule `layoutText` counted the height with.
    overflowWrap: 'break-word',
    wordBreak: 'normal',
    textAlign: 'left',
    overflow: 'hidden',
    // The words never take the pointer: the box around them is the handle.
    pointerEvents: 'none',
  };

  return (
    <div
      data-testid="text-object"
      data-id={object.id}
      data-size={object.size}
      data-width-mode={object.widthMode}
      data-placeholder={editing && empty ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Text"
      aria-roledescription={editable ? 'Text' : 'Text (read-only board)'}
      tabIndex={0}
      style={boxStyle}
      onPointerDown={onPointerDown}
      // A double-click opens the editor, and does not fall through to the board
      // behind it — where it would make a new object instead.
      onDoubleClick={onDoubleClick}
    >
      <div
        data-testid="text-object-text"
        aria-hidden={editing ? 'true' : undefined}
        style={{ ...textStyle, visibility: editing && empty ? 'hidden' : 'visible' }}
      >
        {object.text}
      </div>
      {editing && empty ? (
        <div
          data-testid="text-object-placeholder"
          aria-hidden="true"
          style={placeholderStyle(sizePx)}
        >
          {TEXT_PLACEHOLDER}
        </div>
      ) : null}
      {ytext ? (
        <TextEditor
          ytext={ytext}
          fontPx={sizePx}
          maxChars={TEXT_MAX_CHARS}
          lineHeight={TEXT_LINE_HEIGHT}
          fontFamily={TEXT_FONT_FAMILY}
          ariaLabel="Text"
          testId="text-object-editor"
          containerSelector='[data-testid="text-object"]'
          onInput={remeasureAfterLocalChange}
          // No characters came of the edit: the object goes, and it goes before the
          // undo step closes, so one Ctrl/Cmd+Z brings it back.
          onClosing={(): void => {
            deleteIfEmpty(doc, object.id);
          }}
          // Escape leaves it selected; a click somewhere else has already decided
          // what is selected, and must not be fought over.
          onEnd={onEndEdit}
          undo={undo}
        />
      ) : null}
    </div>
  );
}

/** The grey word that says this empty box is where the typing goes. */
const placeholderStyle = (sizePx: number): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  boxSizing: 'border-box',
  fontFamily: TEXT_FONT_FAMILY,
  fontSize: `${sizePx}px`,
  lineHeight: String(TEXT_LINE_HEIGHT),
  color: '#1f2328',
  opacity: 0.35,
  overflow: 'hidden',
  pointerEvents: 'none',
  whiteSpace: 'pre-wrap',
});

/** The size a text object is drawn at, in board units. */
export const textSizePxOf = (object: TextSnapshot): number => TEXT_SIZES[object.size];
