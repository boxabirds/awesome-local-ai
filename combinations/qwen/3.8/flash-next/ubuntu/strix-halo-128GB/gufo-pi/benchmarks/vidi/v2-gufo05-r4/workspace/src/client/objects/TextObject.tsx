/**
 * Free text on the board (`text.object`) — plain words with no background, no border and
 * no colour of their own.
 *
 * It borrows almost everything. Pressing it, selecting it, moving it, marqueeing it,
 * deleting it and undoing it are story 7's and story 8's code, reached through the
 * registry; typing into it is the same editor a sticky note uses. What is its own:
 *
 *   - **its height belongs to its text.** Four size presets set the font, the words wrap at
 *     however wide the text is allowed to be, and the height is the lines that come out. A
 *     handle that dragged the height would be undone by the next measurement, so the
 *     registry gives this type side handles only (`text.fixed_width`);
 *   - **the box is stored, and only the client that changed the text re-measures it.**
 *     Somebody else typing does not make this screen measure and write — see
 *     `useTextBoxSync`;
 *   - **an empty one is not left on the board.** A text created and then left with nothing
 *     in it is gone when the edit ends (`text.empty_delete`).
 *
 * The words are drawn in the text font at the preset's size, wrapping the way the measurer
 * said they would. There is no styling beyond that — no colour, no highlight, no bold: the
 * size is the emphasis.
 */

import {
  useCallback,
  useRef,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { deleteObjects } from '../../shared/board-model';
import {
  deleteIfEmpty,
  getTextContent,
  isTextSize,
  setTextSize as writeTextSize,
  type TextSnapshot
} from '../../shared/objects/text';
import {
  NOTE_TOOLBAR_GAP_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_COUNTER_THRESHOLD_CHARS,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
  type TextSize
} from '../../shared/config';
import { useUndoController } from '../board/useUndo';
import type { EndEditNext } from '../board/useSelection';
import { getTextMeasurer } from './textLayout';
import { remeasureText, useTextBoxSync } from './useTextBoxSync';
import type { ObjectComponentProps } from './registry';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';

/** The size a document that predates the presets gets. */
const DEFAULT_SIZE: TextSize = 'M';

export function TextObject(props: ObjectComponentProps): JSX.Element {
  const { object, bounds, doc, zoom, selected, editing: editingProp, onStartEdit, onEndEdit } = props;
  const canEdit = props.canEdit !== false;
  // A board that has just become unwritable must not keep an open text box either.
  const editing = editingProp && canEdit;

  const text = object as TextSnapshot;
  /** The preset, or the default for a document that does not carry one. */
  const size = isTextSize(text.size) ? text.size : DEFAULT_SIZE;
  const content = typeof text.text === 'string' ? text.text : '';
  const fontPx = TEXT_SIZES[size];
  const widthMode = text.widthMode === 'fixed' ? 'fixed' : 'auto';

  const latest = useRef({ doc, canEdit, id: object.id, onEndEdit });
  latest.current = { doc, canEdit, id: object.id, onEndEdit };

  // The box is whatever the document holds — this component never draws a measurement of
  // its own, so a remote change and a local one look identical here. The hook is what
  // keeps that number true for changes *this* client makes.
  useTextBoxSync(doc, object.id, getTextMeasurer());

  // A size change or a delete is its own undo step, closed on either side so it never
  // merges with the typing or the drag before it (`undo.steps`).
  const undoController = useUndoController();

  const handleSize = useCallback(
    (next: TextSize) => {
      const current = latest.current;
      if (!current.canEdit || next === size) return;
      undoController?.boundary();
      writeTextSize(current.doc, current.id, next);
      // The same measurement at the new font. The top-left corner does not move: a
      // heading gets bigger down and to the right from where its first letter already is.
      remeasureText(current.doc, current.id, getTextMeasurer());
      undoController?.boundary();
    },
    [size, undoController]
  );

  const handleDelete = useCallback(() => {
    const current = latest.current;
    if (!current.canEdit) return;
    undoController?.boundary();
    deleteObjects(current.doc, [current.id]);
    undoController?.boundary();
    // The text is gone, so the selection goes with it.
    current.onEndEdit('unselected');
  }, [undoController]);

  /** The edit is over. Nothing typed means nothing left behind (`text.empty_delete`). */
  const handleEndEdit = useCallback(
    (next: EndEditNext) => {
      const current = latest.current;
      if (current.canEdit && deleteIfEmpty(current.doc, current.id)) {
        current.onEndEdit('unselected');
        return;
      }
      onEndEdit(next);
    },
    [onEndEdit]
  );

  /** Every local keystroke re-measures, in the same undo step as the keystroke. */
  const remeasure = useCallback(() => {
    remeasureText(latest.current.doc, latest.current.id, getTextMeasurer());
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Editing owns the pointer: a click inside the text places the caret.
      if (editing) {
        event.stopPropagation();
        return;
      }
      props.gesture.onObjectPointerDown(event, object.id);
    },
    [editing, object.id, props.gesture]
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // A double-click on text edits that text rather than creating another one.
      event.stopPropagation();
      if (editing || !canEdit) return;
      onStartEdit(object.id);
    },
    [canEdit, editing, object.id, onStartEdit]
  );

  const stopPointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  // While editing, the textarea wraps at the width the text is allowed — the automatic
  // maximum, or the width that was dragged out of a handle.
  const wrapWidth = widthMode === 'fixed' ? Math.max(bounds.width, 1) : TEXT_MAX_AUTO_WIDTH_WORLD;

  const boxStyle: CSSProperties = {
    left: bounds.x,
    top: bounds.y,
    // The stored box is the hit area and the selection's outline; the words inside it are
    // what they are, and the box is re-measured to fit them the moment this client changes
    // them. `minHeight` rather than `height` so a line the measurer judged narrower than
    // the browser's own font can never clip a word.
    width: bounds.width,
    minHeight: bounds.height,
    fontSize: `${fontPx}px`,
    lineHeight: TEXT_LINE_HEIGHT,
    fontFamily: TEXT_FONT_FAMILY
  };

  const toolbarStyle: CSSProperties = {
    bottom: `calc(100% + ${NOTE_TOOLBAR_GAP_WORLD}px)`,
    transform: `scale(${1 / (zoom || 1)})`
  };

  const ytext = editing ? getTextContent(doc, object.id) : undefined;
  const interaction = props.transforming === true ? 'dragging' : editing ? 'editing' : 'idle';

  return (
    <div
      className="vidi6-text"
      data-vidi6="text"
      data-object-id={object.id}
      data-object-type={object.type}
      data-text-id={object.id}
      data-size={size}
      data-width-mode={widthMode}
      data-x={bounds.x}
      data-y={bounds.y}
      data-width={bounds.width}
      data-height={bounds.height}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={interaction}
      role="group"
      aria-label="Text"
      tabIndex={0}
      style={boxStyle}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext ? (
        <div className="vidi6-text-edit" data-testid="text-edit" onPointerDown={stopPointer}>
          <TextEditor
            ytext={ytext}
            fontPx={fontPx}
            lineHeight={TEXT_LINE_HEIGHT}
            maxChars={TEXT_MAX_CHARS}
            className="vidi6-text-input"
            testId="text-input"
            ariaLabel="Text"
            emptyPlaceholder="Text"
            counterThreshold={TEXT_COUNTER_THRESHOLD_CHARS}
            counterClass="vidi6-text-counter"
            counterTestId="text-counter"
            outsideSelector='[data-vidi6="text"]'
            widthPx={wrapWidth}
            onEnd={handleEndEdit}
            onLocalChange={remeasure}
          />
        </div>
      ) : (
        <div className="vidi6-text-content" data-testid="text-content" data-empty={content.length === 0 ? 'true' : 'false'}>
          {content}
        </div>
      )}

      {selected && props.selectedCount === 1 && !editing && interaction === 'idle' ? (
        <div className="vidi6-text-toolbar-anchor" style={toolbarStyle}>
          <TextToolbar size={size} onSize={handleSize} onDelete={handleDelete} disabled={!canEdit} />
        </div>
      ) : null}
    </div>
  );
}

