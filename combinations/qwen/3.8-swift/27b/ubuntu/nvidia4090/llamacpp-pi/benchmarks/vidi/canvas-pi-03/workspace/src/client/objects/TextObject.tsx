/**
 * Story 9: the free-text board object (text.object).
 *
 * Renders PLAIN text (no fill) at (x, y) with the STORED width/height
 * (measured by the local client that made the last content change —
 * key decision 1), `white-space: pre-wrap`, font TEXT_SIZES[size].
 *
 * Interaction:
 * - press/drag/shift-click go through the generic transform gesture
 *   (selection, move, nudge, delete — story 7/8, text.consistent);
 * - double-click or Enter (single selection, canEdit) starts editing via
 *   the generalised TextEditor;
 * - every local input remeasures the box (text.layout, local-only writes);
 * - ending the edit removes the object when it is empty — an abandoned
 *   text never leaves an invisible object (text.empty_removed);
 * - remote deletion during editing unmounts the editor silently (the board
 *   renders only objects present in the doc).
 */
import type { JSX } from 'react';
import { TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, DEFAULT_TEXT_SIZE, type TextSize } from 'src/shared/config';
import {
  getTextContent,
  getTextSize,
  deleteIfEmpty,
} from 'src/shared/objects/text';
import { createCanvasMeasurer, type Measurer } from './textLayout';
import { remeasureTextBox } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

const SELECTION_OUTLINE = '#1A73E8';

// One shared measurer for the whole board (the canvas probe is cached).
const boardMeasurer: Measurer = createCanvasMeasurer();

export function TextObject(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, editable = true, onStartEdit, onEndEdit, undo } = props;

  // The generic snapshot does not carry size/widthMode; the doc is the
  // source of truth (the component re-renders on every doc change).
  const ytext = getTextContent(doc, obj.id);
  const size: TextSize = getTextSize(doc, obj.id) ?? DEFAULT_TEXT_SIZE;
  const fontPx = TEXT_SIZES[size];
  const text = ytext ? ytext.toString() : '';
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editing) return;
    // The board must not pan while the text is pressed.
    e.stopPropagation();
    // Selection (click / shift-click) and move (drag) are the generic
    // gesture's job, including the load-failed lock (it only selects).
    props.onPointerDown(e, obj.id);
  };

  const handleDblClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Dblclick on the text edits it; the board must not create a new object.
    e.stopPropagation();
    if (!editing && editable) onStartEdit(obj.id);
  };

  const handleEndEdit = (next: 'selected' | 'unselected') => {
    // An abandoned (zero-character) text is removed on edit end; the
    // selection prunes itself from the doc, so the selection clears.
    deleteIfEmpty(doc, obj.id);
    onEndEdit(next);
  };

  return (
    <div
      role="group"
      aria-label="Text"
      tabIndex={0}
      data-testid="text-object"
      data-note-id={obj.id}
      data-selected={selected || undefined}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        // Plain text: no fill, no box — the selection outline is the only
        // affordance (text.object).
        outline: selected ? `2px solid ${SELECTION_OUTLINE}` : 'none',
        outlineOffset: -1,
        cursor: editing ? 'text' : 'text',
        zIndex: obj.z,
        touchAction: 'none',
        userSelect: editing ? 'auto' : 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
      onFocus={() => {
        if (!selected) props.onSelect(obj.id);
      }}
    >
      <div
        data-testid="text-object-text"
        style={{
          position: 'absolute',
          inset: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          fontSize: fontPx,
          lineHeight: TEXT_LINE_HEIGHT,
          color: 'rgba(0,0,0,0.85)',
          visibility: editing ? 'hidden' : 'visible',
          pointerEvents: 'none',
        }}
      >
        {text}
      </div>
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={width}
          onInput={() => remeasureTextBox(doc, obj.id, boardMeasurer)}
          onEnd={handleEndEdit}
          undo={undo}
        />
      )}
    </div>
  );
}
