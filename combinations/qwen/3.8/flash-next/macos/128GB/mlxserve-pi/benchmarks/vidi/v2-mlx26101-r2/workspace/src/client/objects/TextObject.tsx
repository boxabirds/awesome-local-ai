import { useCallback } from 'react';
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import * as Y from 'yjs';

import { moveObjects, type Point, type Rect } from '../../shared/board-model.js';
import { TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config.js';
import {
  deleteIfEmpty,
  getTextContent,
  getTextWidthMode,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../shared/objects/text.js';
import { TextEditor, TEXT_EDITOR_OWNER_ATTRIBUTE } from './TextEditor.js';
import { remeasureTextBox, useTextBoxSync } from './useTextBoxSync.js';
import type { ObjectProps } from './registry.js';

/**
 * One piece of text on the board (`src/client/objects/TextObject.tsx`) - the
 * component the object registry points at for the `text` type.
 *
 * It is the thinnest object the board has, and that is the point: it has no fill,
 * no border, no colour and no toolbar of its own. Everything it draws comes out of
 * the document - the position, the size the text was measured to need, the font
 * size, the text itself - and the two things it does on its own are letting the
 * shared gesture hook have the pointer, and keeping its box the size of its text
 * while somebody is typing (`useTextBoxSync`).
 *
 * What it deliberately does *not* have:
 *
 * - **no measured layout of its own.** `width`/`height` are read, never guessed, so
 *   the selection outline, the marquee and a colleague's screen all agree with what
 *   is drawn here. A component that sized itself from its content would be the only
 *   one on the board whose box nobody else could see.
 * - **no auto-fit.** A sticky note shrinks its font to make text fit; text does the
 *   opposite - it makes room. That is why the height is stored rather than derived
 *   per client, and why the four sizes in the toolbar are the only way a person
 *   changes how big their words are.
 */

/** The editor's accessible name. */
export const TEXT_OBJECT_LABEL = 'Text';

export function TextObject(props: ObjectProps): JSX.Element {
  const {
    object,
    doc,
    zoom,
    selected,
    editing,
    canEdit = true,
    selection,
    gesture,
    undo,
  } = props;
  const text = object as TextSnapshot;

  /** Whether *this* object is part of an in-progress move/resize; the gesture owns it. */
  const dragging = gesture.draggingIds.has(object.id);

  /** The object's shared text; `undefined` only in the moment before its removal. */
  const ytext = getTextContent(doc, object.id);

  // The box this object's text needs, measured by whoever changed it. Mounted or
  // unmounted, this writes nothing by itself: it is a capability, not an effect.
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, object.id);

  const fontPx = TEXT_SIZES[text.size];

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Select, toggle with Shift, and start the group move - the same gesture a
      // note hands over, because moving a text object that is one of six moving is
      // not a text-specific problem (`text.consistent`: selection, move, nudge,
      // delete and marquee are story 7's, unchanged).
      gesture.onObjectPointerDown(event, object.id);
    },
    [gesture, object.id],
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // A double-click on text edits it; it must not fall through to the board
      // behind, which would create something on top of what was double-clicked.
      event.stopPropagation();
      if (editing || !canEdit) return;
      selection.startEdit(object.id);
    },
    [editing, canEdit, selection, object.id],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // Enter on focused text edits it; the board-level handler covers the case
      // where the keyboard belongs to the board and one object is selected.
      if (event.key === 'Enter' && !editing) {
        event.preventDefault();
        if (canEdit) selection.startEdit(object.id);
      }
    },
    [editing, canEdit, selection, object.id],
  );

  const handleTextEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      // An empty text object is not board content: it is a cursor someone summoned
      // and then walked away from, and a board littered with invisible boxes is
      // worse than a click that came to nothing. So the object that is left without
      // a single character goes away here, on the way out (`text.empty_removes`).
      //
      // No undo boundary on either side of this write, on purpose. The last
      // keystroke and this removal are one action in the history - one Ctrl+Z brings
      // the words back - and the editor closes the capture window when it unmounts,
      // just after this returns.
      const removed = deleteIfEmpty(doc, object.id);
      if (removed || next === 'unselected') selection.clear();
      else selection.endEdit();
    },
    [doc, object.id, selection],
  );

  return (
    <div
      className="text-object"
      data-text-object={object.id}
      data-testid="text-object"
      data-object-id={object.id}
      data-size={text.size}
      data-width-mode={text.widthMode}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={TEXT_OBJECT_LABEL}
      tabIndex={0}
      style={{
        left: `${object.x}px`,
        top: `${object.y}px`,
        // The stored box, in board units: the same numbers the selection outline
        // and the marquee use.
        width: `${object.width}px`,
        height: `${object.height}px`,
        fontSize: `${fontPx}px`,
        zIndex: String(text.z),
        ['--inverse-zoom' as string]: String(1 / (zoom || 1)),
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          // The editor wraps at exactly the width that is stored, because the height
          // that is stored was counted from the lines that width produced. A textarea
          // of any other width would put words on lines the box disagrees with.
          width={object.width}
          onInput={remeasureAfterLocalChange}
          onEnd={handleTextEnd}
          undo={undo}
          label={TEXT_OBJECT_LABEL}
          testId="text-editor"
          className="text-editor"
          ownerAttribute={TEXT_EDITOR_OWNER_ATTRIBUTE}
        />
      ) : (
        <div className="text-object-content" data-testid="text-content">
          {text.text}
        </div>
      )}
    </div>
  );
}

/**
 * Apply a handle drag to one text object (`text.handles`).
 *
 * A handle means different things to the two width modes, and this is the only
 * place that knows both:
 *
 * - **fixed width** - the drag is a request for a width, so it is stored as one
 *   (`setTextWidthFixed`, clamped to {@link TEXT_MIN_WIDTH_WORLD}) and the height is
 *   measured again for the lines that width produces. This is the whole "drag the
 *   side handle narrower and the text rewraps taller" of the story.
 * - **automatic width** - the text itself decides how wide it is, so a drag moves
 *   the object and leaves the width alone. `sole` says whether this object *is* the
 *   selection: dragging the one selected text by its side handle is asking for a
 *   width, so it becomes fixed; being scaled along with other objects is not, and a
 *   group resize must not silently convert anybody's automatic text.
 *
 * The height is never written from the drag in either mode - it is always the
 * measurement of the lines - and the font size never changes, at any zoom, in any
 * selection (`text.mixed_resize`).
 */
export function resizeTextObject(
  doc: Y.Doc,
  id: string,
  rect: Rect,
  sole: boolean,
): boolean {
  const positions = new Map<string, Point>();
  positions.set(id, { x: rect.x, y: rect.y });
  const wantsFixedWidth = sole || getTextWidthMode(doc, id) === 'fixed';
  const widthWritten = wantsFixedWidth ? setTextWidthFixed(doc, id, rect.width) : false;
  const moved = moveObjects(doc, positions) > 0;
  // Height - and, for automatic text, width - come from the measurement, not from
  // the rectangle the pointer described.
  const boxWritten = remeasureTextBox(doc, id);
  return widthWritten || moved || boxWritten;
}

export default TextObject;
