/**
 * One piece of free text on the board (`text.*`).
 *
 * It renders a text object from the snapshot:
 *
 *   Unselected ──pointerdown──▶ Selected ──dblclick / Enter──▶ Editing ──Escape / blur──▶ gone, if empty
 *
 * The shape of it is a sticky note's: positions and sizes are world units, the press is
 * handed to the board so that one gesture moves the whole selection, and editing is the
 * shared field with a `contenteditable` div. What is different is the interesting part of
 * this story.
 *
 * **The box is measured, not stored by choice.** `width` and `height` are kept up to date
 * by `useTextBoxSync`, which re-measures after this person's own changes and never after
 * anybody else's — so the two boards converge instead of arguing. A note's box is its own
 * and does not care what is written in it.
 *
 * **An empty box is not a thing.** A person who clicks to write and then thinks better of
 * it leaves nothing behind (`text.empty`): the object is deleted when they stop editing an
 * empty one. That is also why the click that places the text starts editing it straight
 * away — a box of text that is not being typed into is either content or a mistake, and
 * this is how the mistake disappears.
 *
 * **The caret belongs to the person typing.** While they type, the DOM is never rewritten
 * from the document; only the box around it changes (`text.edit`), which is what keeps the
 * caret and the browser's own line-breaking where they are.
 */
import { useCallback, type CSSProperties } from 'react';
import * as Y from 'yjs';

import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../shared/config';
import { deleteIfEmpty, getText, type TextSnapshot } from '../../shared/objects/text';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { sharedMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';

/**
 * `ObjectProps.obj` is the widest snapshot the board works with; this component is
 * registered under `text`, so what reaches it was read as a piece of text. Checking the
 * type keeps a mis-registered object from drawing half a paragraph.
 */
function asText(obj: ObjectProps['obj']): TextSnapshot | null {
  return obj.type === 'text' ? (obj as TextSnapshot) : null;
}

export function TextObject(props: ObjectProps) {
  const {
    doc,
    selected,
    editing,
    canEdit,
    onObjectPointerDown,
    onFocusSelect,
    onStartEdit,
    onEndEdit,
    undo,
  } = props;
  const text = asText(props.obj);

  // Keeps this object's box equal to its content, for this person's changes only. An id
  // that is not there (a snapshot of another type, which the registry would not route
  // here) measures nothing and writes nothing.
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, text?.id ?? '', sharedMeasurer());

  /**
   * Stop editing, and take the object away if nothing was ever written into it.
   *
   * The boundaries are what make the deletion its own undo step rather than the end of a
   * burst of typing (`undo.steps`): the typing is one step, and the throwing-away of an
   * empty box is another — which is how Ctrl+Z can bring it back (TC-21).
   */
  const endEdit = useCallback(() => {
    if (text) {
      undo?.boundary();
      deleteIfEmpty(doc, text.id);
      undo?.boundary();
    }
    onEndEdit();
  }, [doc, onEndEdit, text, undo]);

  if (!text) return null;

  const fontPx = TEXT_SIZES[text.size];
  // The editable container, and only while this object is being edited: a field opened on
  // an object with no `Y.Text` would have nowhere to write.
  const ytext: Y.Text | undefined = editing ? getText(doc, text.id) : undefined;
  // What is shown when nobody is typing is the snapshot's string, which is the same text
  // the container holds — the snapshot is read out of it.
  const shown = text.text;

  const box: CSSProperties = {
    left: text.x,
    top: text.y,
    width: text.width,
    height: text.height,
    zIndex: text.z,
    fontSize: `${fontPx}px`,
    lineHeight: TEXT_LINE_HEIGHT,
  };

  return (
    <div
      data-text-object
      data-testid="text-object"
      data-object-id={text.id}
      data-object-type="text"
      data-text-id={text.id}
      // The selection state, for assistive technology and for the tests that read the
      // board as the user sees it (`sel.*`).
      data-selected={selected ? 'true' : 'false'}
      data-text-x={text.x}
      data-text-y={text.y}
      data-text-z={text.z}
      data-text-width={text.width}
      data-text-height={text.height}
      data-text-size={text.size}
      data-text-width-mode={text.widthMode}
      data-text-length={shown.length}
      role="group"
      aria-label="Text"
      tabIndex={0}
      className={['text-object', selected ? 'text-object--selected' : '', editing ? 'text-object--editing' : '']
        .filter(Boolean)
        .join(' ')}
      style={box}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Never let this reach the viewport: pressing text must not pan the board or
        // clear the selection it belongs to.
        event.stopPropagation();
        if (editing) return; // clicks inside the editor place the caret
        onObjectPointerDown(event, text.id);
      }}
      onContextMenu={(event) => {
        // Long-press on a touch device selects the text instead of opening the
        // browser's own menu.
        event.preventDefault();
        if (!editing) onFocusSelect(text.id);
      }}
      onFocus={() => {
        if (!editing && !selected) onFocusSelect(text.id);
      }}
      onDoubleClick={(event) => {
        // A double-click on text edits it; it must never create another object.
        event.stopPropagation();
        if (editing || !canEdit) return;
        onStartEdit(text.id);
      }}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          sizePx={fontPx}
          onEnd={endEdit}
          undo={undo}
          // Words changed here change the space they need: re-measure and write the box,
          // which is a local change and therefore this person's to sync (`text.autosize`).
          onLocalText={remeasureAfterLocalChange}
        />
      ) : (
        <div
          className="text-object__content"
          data-testid="text-object-text"
          style={{ fontSize: `${fontPx}px`, lineHeight: TEXT_LINE_HEIGHT }}
        >
          {shown}
        </div>
      )}
    </div>
  );
}
