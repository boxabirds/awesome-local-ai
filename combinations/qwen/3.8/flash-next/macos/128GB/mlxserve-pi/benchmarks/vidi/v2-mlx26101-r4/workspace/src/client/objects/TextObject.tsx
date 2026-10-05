/**
 * One piece of text on the board: how it looks, how it is picked, how it is typed into.
 *
 * A sticky note is a shape with text in it. This is the other thing: text on its own, with no card to hold
 * it — a heading over a column of notes, one word in a corner, a paragraph with nothing round it. What that
 * costs, in code, is one field: a note's box is a thing a person drags, and this object's box is a
 * *consequence*. Its height is counted in lines, and its width is either as wide as its widest line or as
 * wide as somebody dragged it, and the layout of the words decides which. So most of what this file does is
 * not draw, it is ask the layout engine what the words need and keep the box honest about it.
 *
 * Three things are worth naming before the code:
 *
 * **The box is drawn from the document, never measured here.** Measurement is the client that *changed* the
 * text's job (see `textLayout.ts`), and a component that measured during render would be five clients
 * measuring one heading and storing five boxes for it. What is drawn is the width and height the document
 * holds, so the frame around a heading is the same shape on every machine — including on the machine whose
 * font would have made it wider.
 *
 * **Only a local keystroke measures.** The editor is handed `useTextBoxSync`'s function, which it calls
 * after it has written; a colleague's keystroke arrives through the editor's observer, which does not call
 * it. That is the difference between one write per keystroke and one per keystroke per person looking.
 *
 * **An empty one is not kept.** Text that never got a character is removed when the edit ends, which is
 * what an abandoned "click the board, change my mind" is. A space is a character: this is not a check for
 * whether the board looks used, it is a check for whether anything was ever written.
 *
 * The states are the note's, and read rather than driven: idle → pressed → dragging → idle, and idle →
 * selected → editing → selected.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

import { deleteObject, objectBounds } from '../../shared/board-model';
import { DEFAULT_TEXT_SIZE, TEXT_COUNTER_THRESHOLD_CHARS, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import {
  deleteIfEmpty,
  getTextContent,
  readText,
  TEXT_OBJECT_TYPE,
} from '../../shared/objects/text';
import { changeTextSize } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import type { ObjectProps } from './objectProps';

export type TextObjectProps = ObjectProps;

/** Gap between the top of a piece of text and its toolbar, in screen pixels. */
const TOOLBAR_GAP_PX = 8;

/** The mouse button that picks text up. */
const PRIMARY_MOUSE_BUTTON = 0;

export function TextObject(props: TextObjectProps): JSX.Element {
  const { object, doc, zoom, selected, selectedCount, editing, readOnly, interaction } = props;
  const { onEndEdit, undo } = props;
  const elementRef = useRef<HTMLDivElement>(null);

  // The object's own fields, read from the document rather than from the generic snapshot the board hands
  // out (which knows position and box and nothing about sizes). Reading is cheap and always current: the
  // board re-renders from a fresh snapshot on every document change, so there is nothing to keep in sync.
  const read = readText(doc, object.id);
  const text = read?.text ?? '';
  const size = read?.size ?? DEFAULT_TEXT_SIZE;
  const fontPx = TEXT_SIZES[size];
  // The box the document holds. `objectBounds` and this are the same rect — which is the whole point of
  // storing a box: the outline, the marquee, the hit test and this element all draw one set of numbers.
  const bounds = objectBounds(object);

  /**
   * Measure the words, after this person changed them.
   *
   * Handed to the editor, which calls it once per local keystroke, after the write. Not an observer, and
   * not called while rendering: the box has to be in the document before the browser paints, which it is,
   * because the write and this call are both synchronous and the paint comes after.
   */
  const measureBox = useTextBoxSync(doc, object.id);

  /**
   * The edit is over: keep it if it says something, take it away if it never did.
   *
   * Both with a boundary either side, because a text created, typed into and abandoned is one thing a
   * person did — and one undo of the *deletion* has to bring the words back, not half of them. Ending
   * happens through more than one door (Escape, a press anywhere else, a blur) and every one of them comes
   * through here, which is why the removal is not written in the Escape handler: an abandoned text that
   * only got cleaned up when Escape was pressed is an abandoned text that stays on the board when the
   * person clicked away from it, and clicking away is what everybody does.
   */
  const endEdit = useCallback((): void => {
    undo?.boundary();
    deleteIfEmpty(doc, object.id);
    undo?.boundary();
    onEndEdit();
  }, [doc, object.id, onEndEdit, undo]);

  // The press, handed straight to the board — see StickyNote for why nothing is decided here beyond which
  // presses are not the board's business.
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (readOnly) {
      event.stopPropagation();
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    event.stopPropagation();
    // While this text is open, the press belongs to the text; the press that closes it is caught by the
    // listener below, which runs before this one.
    if (editing) return;
    props.onPointerDown(event, object.id);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (editing || readOnly) return;
    props.onStartEdit(object.id);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter') return;
    // While typing, Enter adds a line: a keydown that started in the textarea arrives here by bubbling, and
    // must not be swallowed.
    if (editing || readOnly) return;
    event.preventDefault();
    props.onStartEdit(object.id);
  };

  // A pointerdown anywhere outside this text ends the edit — and, unlike a note's, may take the text with
  // it. Capture phase, so it runs before the board reacts to the same press.
  //
  // It goes through `endEdit` rather than straight to `onEndEdit`, because clicking away from a piece of
  // text is how an abandoned one is left behind: the person presses somewhere else, and if all that
  // happened there was a caret and nothing else, that is the moment the board should be rid of it. A note
  // can wait for its textarea to blur and call it nobody's business; an empty text has no reason to stay.
  useLayoutEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent): void => {
      const element = elementRef.current;
      if (element && event.target instanceof Node && element.contains(event.target)) return;
      endEdit();
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  }, [editing, endEdit]);

  // A text object that stops existing ends its own edit, whoever took it.
  //
  // This is not a nicety: without it the textarea stays open on a `Y.Text` that no longer has a document,
  // and every keystroke into it is silently lost — which is the one thing a person cannot be left to find
  // out for themselves, because from where they are sitting the caret is still blinking. There is nothing
  // to write, and nothing to recreate: the object is gone, and the edit goes with it.
  const exists = read !== null;
  useEffect(() => {
    if (!editing || exists) return;
    onEndEdit();
  }, [editing, exists, onEndEdit]);

  const ytext = editing ? getTextContent(doc, object.id) : undefined;
  // The toolbar is the control for one piece of text. With two or more objects selected the selection bar
  // is the control that is honest about what it acts on, and the two must never be on screen together.
  //
  // It hangs off this object rather than off the selection bar for the same reason a note's colours do: it
  // needs the object's own fields (which size is this one?) and the bar is drawn for a *group*, which has
  // no size to show. The bar asks nothing of a single object; the object already knows the answer.
  //
  // It stays while the text is being typed into, which a note's colours do not. The reason is what the two
  // toolbars are for: a colour is a thing you decide about a note you are looking at, and once the caret is
  // in it you are reading your own words; a text's four sizes are the thing you are deciding *about* the
  // words, and a person who wants their heading bigger mid-sentence would otherwise have to stop, click
  // away, find the object again and click the button. One object, one selection, one toolbar — editing or
  // not, and never the selection bar's bin next to it.
  const showsToolbar = selected && selectedCount === 1 && interaction !== 'dragging';

  /**
   * The toolbar, and the shelf it sits on above the text.
   *
   * Built here rather than in two places because there is one of it and it must not differ: while editing it
   * is handed to the editor, which puts it in its own box; while not, it is put in the object's box. The box
   * and the object are the same rectangle either way, which is what lets the shelf below line up with the
   * text in both — and the counter-scale is what keeps the buttons the size they are on screen no matter how
   * far the board is zoomed out.
   */
  const toolbarSlot = (
    <div
      className="text-object__toolbar-slot"
      data-testid="text-toolbar-slot"
      style={{
        bottom: '100%',
        // The object itself is scaled by the zoom, so scaling the toolbar by the reciprocal keeps it
        // the same size on screen at every zoom.
        transform: `scale(${1 / (zoom > 0 ? zoom : 1)}) translateY(${-TOOLBAR_GAP_PX}px)`,
      }}
    >
      <TextToolbar
        size={size}
        disabled={readOnly}
        onSize={(next) => {
          // The letters and the box they are in, as one change: see `changeTextSize`. The boundaries
          // are the note's, for the note's reason — a size clicked a breath after a drag let go would
          // otherwise be folded into the drag's step, and would only come back by undoing the drag
          // along with it.
          props.undo?.boundary();
          changeTextSize(doc, object.id, next);
          props.undo?.boundary();
        }}
        onDelete={() => {
          // One object, the one this toolbar belongs to. The board drops the selection with it.
          props.undo?.boundary();
          deleteObject(doc, object.id);
          props.undo?.boundary();
        }}
      />
    </div>
  );

  return (
    <div
      ref={elementRef}
      className="text-object"
      role="group"
      aria-label="Text"
      data-testid="text-object"
      data-text-id={object.id}
      data-text-type={TEXT_OBJECT_TYPE}
      data-text-size={size}
      data-text-width-mode={read?.widthMode ?? 'auto'}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={interaction}
      tabIndex={0}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        fontSize: `${fontPx}px`,
        // Stacking lives here, not in the order of the children: raising text that is held has to be a
        // style change, not a move in the document.
        zIndex: object.z,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          counterThreshold={TEXT_COUNTER_THRESHOLD_CHARS}
          fontPx={fontPx}
          // No `fitBox`: this text is the size the person chose, and writes more of it instead of
          // shrinking what they wrote. The box grows round it, which is the whole difference.
          onInput={measureBox}
          onEnd={endEdit}
          undo={props.undo}
          textareaTestId="text-textarea"
          counterTestId="text-counter"
          ariaLabel="Text"
          wrapperClassName="text-object__editor"
          textareaClassName="text-object__textarea"
          counterClassName="text-object__counter"
          editorTestId="text-editor"
          toolbarSlot={showsToolbar ? toolbarSlot : undefined}
        />
      ) : null}
      {editing ? null : (
        // The words, in the box the document says they have. `white-space: pre-wrap` is what makes the
        // newlines a person typed stay where they typed them, and the wrap the layout engine measured
        // happen in the same places the browser puts them.
        <div className="text-object__text" data-testid="text-content">
          {text}
        </div>
      )}
      {!editing && showsToolbar ? toolbarSlot : null}
    </div>
  );
}
