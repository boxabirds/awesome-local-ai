import { useMemo } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

import { TEXT_MAX_CHARS } from '../../shared/config';
import { objectBounds } from '../../shared/board-model';
import {
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  isTextSnapshot,
  textFontSizeWorld,
} from '../../shared/objects/text';
import { createCanvasMeasurer } from './textLayout';
import { TextEditor } from './TextEditor';
import { useTextBoxSync } from './useTextBoxSync';
import type { ObjectProps } from './registry';

/**
 * One piece of text on the board, drawn from its object snapshot and registered as
 * an object type (`text.object`, `sel.registry`).
 *
 * It is what a heading *is* once the board has taken the rest away: words in a box,
 * no fill, no border, and nothing that makes a decision. Selecting, moving,
 * deleting and the undo history are the board's (stories 7 and 8), and so is
 * whether a press becomes a drag. Two things are specific to text, and both are
 * read from the document rather than worked out here — the size preset it is written
 * in, and the box it was measured into.
 *
 * The box is stored, not computed at render (`text.height`): every screen draws
 * text a little differently, and the only honest height on this screen is the one
 * the person who changed the text measured. That is what `useTextBoxSync` keeps to,
 * and this component only ever renders the numbers that came out of it.
 */
export function TextObject({
  object,
  doc,
  selected,
  editing,
  editable,
  dragging,
  undo,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectProps): JSX.Element | null {
  const text = isTextSnapshot(object) ? object : undefined;
  // A record that is not a text's — from a type this build does not know how to
  // draw, or an older board — cannot be drawn as text, so it is not drawn at all.
  if (!text) return null;
  const bounds = objectBounds(text);
  const fontPx = textFontSizeWorld(text.size);

  // The measurer lives as long as this object is on the board: it caches one
  // canvas, and jsdom's missing `getContext` is already handled inside it.
  const measure = useMemo(() => createCanvasMeasurer(), []);
  const sync = useTextBoxSync(doc, text.id, measure);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // The board must not pan, and this text must not be deselected because of a
    // press on it: the generic gesture owns the press (`sel.transform`).
    event.stopPropagation();
    // While the words are being typed, the field owns the pointer: a press that
    // started a drag would also end the edit it was typing into.
    if (editing) return;
    onObjectPointerDown(event, text.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // A double-click on text edits it rather than doing anything else (a heading
    // is not a place to start a note).
    event.stopPropagation();
    if (editable && !editing) onStartEdit(text.id);
  };

  // `text.empty`: text nobody typed into is not an object. It is removed when the
  // edit ends — not while it is open, because an empty heading is exactly what a
  // person is looking at for the first second of typing — and the selection lets
  // go of it by itself, because the board drops objects that vanish (`live.delete_
  // during_edit`).
  const endEdit = (next: 'selected' | 'unselected'): void => {
    if (isEmptyText(doc, text.id)) {
      deleteIfEmpty(doc, text.id);
      onEndEdit('unselected');
      return;
    }
    onEndEdit(next);
  };

  const ytext = getTextContent(doc, text.id);

  return (
    <div
      className="text-object"
      role="group"
      aria-label="Text"
      data-text-id={text.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-size={text.size}
      data-width-mode={text.widthMode}
      data-x={text.x}
      data-y={text.y}
      data-z={text.z}
      data-width={bounds.width}
      data-height={bounds.height}
      tabIndex={0}
      style={{
        left: `${text.x}px`,
        top: `${text.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        fontSize: `${fontPx}px`,
        zIndex: text.z,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {/* The words as the board holds them. Kept mounted while editing — hidden,
          like a note's text — so the words that are there stay readable in the
          outline of the object being typed into, and so the box has something in
          it while the field is empty. */}
      <div
        className="text-object-content"
        data-testid="text-content"
        aria-hidden={editing ? 'true' : undefined}
        style={{ visibility: editing ? 'hidden' : 'visible' }}
      >
        {text.text}
      </div>
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          // As wide as the box the text was measured into, so the line breaks
          // while typing land where the finished text breaks.
          width={bounds.width}
          onInput={sync.remeasureAfterLocalChange}
          onEnd={endEdit}
          undo={undo}
          className="text-editor"
          testId="text-editor"
        />
      ) : null}
    </div>
  );
}
