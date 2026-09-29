// A free-text object (story 9 `text.object`).
//
// It renders inside the zoomed world layer as plain, unfilled text at its stored
// (x, y) with the stored width/height and the size preset's font. Everything else —
// selection, move, group resize, delete, marquee, nudge, undo — comes unchanged from
// stories 7 and 8 through the registry (text.consistent): this component adds no
// selection code of its own.
//
// Editing opens the shared TextEditor. Because the box is the single writer's job, the
// editor's `onInput` calls `remeasureAfterLocalChange` (the local client writes the new
// box; peers render it, they never re-measure). Ending an edit that left the text empty
// deletes the object — an "abandoned text" leaves nothing behind (TC-20, TC-31). A text
// deleted remotely while being edited simply stops rendering and ends silently.

import { useCallback } from 'react';
import type * as Y from 'yjs';
import type { ObjectProps, ObjectToolbarProps } from './registry.tsx';
import {
  asTextSnapshot,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
  setTextSize as writeTextSize,
} from '../../shared/objects/text.ts';
import { TEXT_MAX_CHARS, TEXT_SIZES, type TextSize } from '../../shared/config.ts';
import { TextEditor } from './TextEditor.tsx';
import { TextToolbar } from './TextToolbar.tsx';
import { useTextBoxSync } from './useTextBoxSync.ts';
import { textMeasure } from './measurer.ts';
import { useUndoController, useUndoBoundary } from '../board/useUndo.ts';
import { objectBounds } from '../../shared/board-model.ts';

// The shared canvas measurer (see ./measurer.ts) is what both the box sync and the
// horizontal resize gesture lay text out with.

export interface TextObjectProps extends ObjectProps {}

export function TextObject(props: TextObjectProps) {
  const { obj, doc, selected, editing, onEndEdit } = props;
  const canEdit = props.canEdit ?? true;
  const note = asTextSnapshot(obj);
  const bounds = objectBounds(obj);
  // The board's undo controller: a text is always rendered inside a board that mounted
  // one, so the editor can route Ctrl/Cmd+Z to it.
  const undo = useUndoController();

  const { remeasureAfterLocalChange } = useTextBoxSync(doc as Y.Doc, note.id, textMeasure);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return; // the editor textarea owns its own pointer events
    props.onObjectPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // never a create-text behind it
    if (!canEdit) return; // editing is locked on an unloadable board
    props.onObjectDoubleClick(e, obj.id);
  };

  // Ending an edit: an empty text is deleted (and the selection cleared with it, which
  // `deleteObjects` does not do — the selection ends 'unselected'); a text with
  // characters keeps whatever selection state the editor asked for.
  const endEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      if (isEmptyText(doc as Y.Doc, note.id)) {
        deleteIfEmpty(doc as Y.Doc, note.id);
        onEndEdit('unselected');
        return;
      }
      onEndEdit(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, note.id, onEndEdit],
  );

  const ytext = editing ? getTextContent(doc as Y.Doc, note.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Text"
      data-selected={selected ? 'true' : 'false'}
      data-text-id={obj.id}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        minHeight: bounds.height,
        boxSizing: 'border-box',
        color: '#2c2f36',
        fontSize: TEXT_SIZES[note.size],
        lineHeight: 1.3,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
        zIndex: obj.z,
        pointerEvents: 'auto',
        cursor: 'text',
        outline: selected ? '1px solid #2f6fed' : 'none',
        outlineOffset: 2,
        userSelect: editing ? 'text' : 'none',
        background: 'transparent',
      }}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={TEXT_SIZES[note.size]}
          width="auto"
          onInput={remeasureAfterLocalChange}
          onEnd={endEdit}
          undo={undo!}
          limitHint={`Limit reached · ${TEXT_MAX_CHARS} characters`}
          testId="text-object-editor"
        />
      ) : (
        <div data-testid="text-object-content" style={{ width: '100%' }}>
          {note.text}
        </div>
      )}
    </div>
  );
}

/**
 * The floating toolbar of one selected text (story 9): the four size presets and
 * Delete. It floats where the board places a single-object toolbar (the same anchor as
 * the note toolbar). Choosing a size writes it and remeasures, keeping the top-left.
 */
export function TextObjectToolbar(props: ObjectToolbarProps) {
  const note = asTextSnapshot(props.obj);
  const { remeasureAfterLocalChange } = useTextBoxSync(props.doc, note.id, textMeasure);
  const boundary = useUndoBoundary();
  const onSize = (size: TextSize) => {
    if (!props.canEdit) return;
    boundary();
    if (writeTextSize(props.doc, note.id, size)) remeasureAfterLocalChange();
    boundary();
  };
  return <TextToolbar size={note.size} onSize={onSize} onDelete={() => props.onDelete?.()} />;
}

// `objects/registry.tsx` registers this component as the 'text' type.
export default TextObject;
