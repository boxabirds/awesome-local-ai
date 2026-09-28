// A text object on the board (story 9, text.object): free text placed
// anywhere by the Text tool. Renders at its stored world position/box in
// the world layer; the box (width/height) is measured by the local client
// (text.layout + text.box_sync) and stored on the object.
//
// Interaction:
//  - click selects (generic gesture); double-click / Enter edits;
//  - editing: the shared TextEditor fills the box; every committed input
//    re-measures the box (local changes only);
//  - Escape ends editing and keeps the selection; a click outside ends it
//    and clears it (text.selected);
//  - an object that ends editing with ZERO characters is deleted
//    (text.empty_removed) — in the same capture window as the last edit,
//    so one undo restores it.

import { type ReactElement } from 'react';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import { deleteIfEmpty, getTextContent, textSnapshot } from '../../shared/objects/text';
import { createCanvasMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

// One shared measurer for the whole page (the canvas context is reused).
let pageMeasurer: ReturnType<typeof createCanvasMeasurer> | null = null;
function pageMeasurerShared() {
  if (pageMeasurer === null) pageMeasurer = createCanvasMeasurer(TEXT_FONT_FAMILY);
  return pageMeasurer;
}

export function TextObject(props: ObjectProps): ReactElement {
  const { obj, doc, selected, editing, locked, dragging } = props;
  // The extended snapshot comes from the renderer; a defensive re-read
  // covers any path that renders without it.
  const note = props.note ?? textSnapshot(doc, obj.id);
  const size = note?.size ?? 'M';
  const fontPx = TEXT_SIZES[size];
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;

  const { remeasureAfterLocalChange } = useTextBoxSync(doc, obj.id, pageMeasurerShared());

  // A remote deletion while editing unmounts the editor cleanly: the
  // object stops rendering, the selection prune ends editing (text.remote).
  const ytext = getTextContent(doc, obj.id);

  const onPointerDownText = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (editing) return; // the textarea owns the pointer while editing
    props.onPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation(); // editing the text, never creating a new one
    if (locked) return; // load-failed: no text editing
    props.onStartEdit(obj.id);
  };

  const onEnd = (next: 'selected' | 'unselected'): void => {
    // Zero characters at edit end: delete the object (text.empty_removed),
    // inside the typing capture window (see TextEditor.finish).
    if (deleteIfEmpty(doc, obj.id)) {
      props.onEndEdit();
      return;
    }
    if (next === 'unselected') props.onClearSelection?.();
    else props.onEndEdit();
  };

  return (
    <div
      role="group"
      aria-label={obj.text === '' ? 'Text' : obj.text}
      data-testid="text-object"
      data-id={obj.id}
      data-selected={selected ? 'true' : undefined}
      data-editing={editing ? 'true' : undefined}
      data-width-mode={note?.widthMode ?? 'auto'}
      className={`text-object${selected ? ' text-object--selected' : ''}${
        selected && dragging ? ' text-object--dragging' : ''
      }`}
      tabIndex={0}
      style={{
        left: obj.x,
        top: obj.y,
        width,
        height,
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: fontPx,
        lineHeight: TEXT_LINE_HEIGHT,
      }}
      onPointerDown={onPointerDownText}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        if (!selected) props.onSelect(obj.id); // Tab-reachable, announced by content
      }}
    >
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          onInput={remeasureAfterLocalChange}
          onEnd={onEnd}
          undo={props.undo}
        />
      ) : (
        <div className="text-object-text" data-testid="text-object-text">
          {obj.text}
        </div>
      )}
    </div>
  );
}
