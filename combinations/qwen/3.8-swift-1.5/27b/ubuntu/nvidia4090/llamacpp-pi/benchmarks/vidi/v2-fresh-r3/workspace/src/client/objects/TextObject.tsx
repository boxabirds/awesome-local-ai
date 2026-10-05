import { useContext } from 'react';
import type { JSX } from 'react';
import {
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_FONT_FAMILY,
  TEXT_MAX_CHARS,
  TEXT_PADDING_WORLD,
} from '../../shared/config';
import { getTextContent, deleteIfEmpty, toTextSnapshot } from '../../shared/objects/text';
import { createCanvasMeasurer, type Measurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import { ToolContext } from '../board/useTool';
import type { ObjectProps } from './registry';

const SELECTION_OUTLINE = '2px solid #1A73E8';

// One shared measurer for the whole board (canvas-based; estimate fallback
// where no canvas exists, e.g. jsdom).
const measurer: Measurer = createCanvasMeasurer();

/**
 * One free text object in the world layer (story 9, text.editor /
 * text.layout). Renders the stored box at (x, y) with the size preset's font;
 * the box (width/height) is content-driven via `useTextBoxSync` on this
 * client. Selection, move and delete are generic (useTransformGesture,
 * board-model). Double-click / Enter edits in place; ending editing on empty
 * text removes the object (text.empty_removed).
 *
 * In the text tool the object is pointer-transparent (`ToolContext`), so a
 * click anywhere — even over it — creates new text at the click point.
 */
export function TextObject(props: ObjectProps): JSX.Element | null {
  const {
    obj, doc, selected, editing, dragging,
    onObjectPointerDown, onStartEdit, onEndEdit, undo,
  } = props;
  const tool = useContext(ToolContext);

  const note = toTextSnapshot(obj);
  const sync = useTextBoxSync(doc, obj.id, measurer);
  if (!note) return null;

  const size = note.size;
  const fontPx = TEXT_SIZES[size];
  const width = obj.width ?? TEXT_PADDING_WORLD;
  const height = obj.height ?? fontPx * TEXT_LINE_HEIGHT;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return; // the textarea handles pointers while editing
    e.stopPropagation(); // dragging text never pans the board
    e.preventDefault();
    onObjectPointerDown(e, obj.id);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // a double-click on text edits it, never creates
    if (editing) return;
    onStartEdit(obj.id);
  };

  const handleEndEdit = (next: 'selected' | 'unselected') => {
    // Empty text is removed when editing ends (text.empty_removed). The
    // delete lands in the same undo window as the typing (story 8).
    if (deleteIfEmpty(doc, obj.id)) {
      onEndEdit('unselected');
    } else {
      onEndEdit(next);
    }
  };

  return (
    <div
      role="group"
      aria-label={note.text || 'Text'}
      data-text-id={obj.id}
      data-selected={selected}
      data-dragging={dragging || undefined}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        outline: selected ? SELECTION_OUTLINE : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        boxSizing: 'border-box',
        pointerEvents: tool === 'text' ? 'none' : 'auto',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing ? (
        <TextEditor
          ytext={getTextContent(doc, obj.id)!}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={width}
          onInput={sync.remeasureAfterLocalChange}
          onEnd={handleEndEdit}
          undo={undo}
          testId="text-editor"
          textareaTestId="text-textarea"
          textareaStyle={{
            color: '#222',
            fontFamily: TEXT_FONT_FAMILY,
            lineHeight: TEXT_LINE_HEIGHT,
          }}
        />
      ) : (
        <div
          data-testid="text-content"
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            color: '#222',
            fontFamily: TEXT_FONT_FAMILY,
            fontSize: fontPx,
            lineHeight: TEXT_LINE_HEIGHT,
            pointerEvents: 'none',
          }}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}
