// A free text on the board (story 9): a box of glyphs and nothing else - no
// background, no colour, no rotation. It renders itself through the story 7
// generic object machinery exactly like the sticky note: it owns only what a
// text looks like and its editor; selection, moving and the side-handle resize
// are the shared gesture's, and it carries no selection code of its own.
//
// The one thing no other type does: its box is COMPUTED. The height always is,
// the auto width mostly - textLayout.ts decides what the box is and
// useTextBoxSync writes that answer whenever a local change moves what it lays
// out to. This component's whole layout duty is to mount the editor at the
// stored box width, so the caret wraps exactly where the text wraps.
import type React from 'react';
import { TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_FONT_FAMILY, TEXT_MIN_WIDTH_WORLD, DEFAULT_TEXT_SIZE } from '../../shared/config.ts';
import type { TextSize } from '../../shared/config.ts';
import { getTextContent, deleteIfEmpty } from '../../shared/objects/text.ts';
import { TextEditor } from './TextEditor.tsx';
import { useTextBoxSync } from './useTextBoxSync.ts';
import type { ObjectProps } from './registry.tsx';
import type { EndMode } from '../board/useSelection.ts';

function fontSizeOf(size: string | undefined): number {
  return TEXT_SIZES[(size ?? DEFAULT_TEXT_SIZE) as TextSize] ?? TEXT_SIZES[DEFAULT_TEXT_SIZE];
}

function widthOf(obj: ObjectProps['obj']): number {
  const w = obj.width;
  return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : TEXT_MIN_WIDTH_WORLD;
}

function heightOf(obj: ObjectProps['obj'], fontPx: number): number {
  const h = obj.height;
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : fontPx * TEXT_LINE_HEIGHT;
}

export function TextObject(props: ObjectProps): React.JSX.Element {
  const { obj, doc, selected, editing, editable, onObjectPointerDown, onStartEdit, onEndEdit } = props;

  // The box follows every LOCAL write that changes what the text lays out to
  // - typing here, a size press, a side-handle drag - and writes nothing when
  // the stored box already agrees (TC-13). The measurer is the hook's own
  // canvas fallback chain; this component does not measure anything by hand.
  const sync = useTextBoxSync(doc, obj.id);

  const text = obj.text ?? '';
  const fontPx = fontSizeOf(obj.size);
  const width = widthOf(obj);
  const height = heightOf(obj, fontPx);
  const ytext = getTextContent(doc, obj.id);

  // The generic grab: exactly the sticky note's contract - select / drag through
  // the shared gesture, and on a read-only board the press is not even swallowed,
  // so panning over a text still pans.
  const genericPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!editable) return;
    e.stopPropagation(); // the board must never pan when a text is grabbed
    if (editing) return; // clicks inside the editor are handled there
    onObjectPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable) return;
    e.stopPropagation();
    if (editing) return;
    onStartEdit(obj.id);
  };

  // Ending an edit: a text nobody typed into leaves nothing behind - the object
  // removes itself (one undo step, story 8, TC-04/TC-28) - and the selection
  // lands in the mode the end asked for. Whitespace is text: it stays.
  const endEdit = (next: EndMode) => {
    deleteIfEmpty(doc, obj.id);
    onEndEdit(next);
  };

  return (
    <div
      role="group"
      aria-label={text === '' ? 'Empty text' : text}
      data-testid={`text-${obj.id}`}
      data-object-id={obj.id}
      data-selected={selected}
      data-editable={editable}
      data-editing={editing}
      data-width={width}
      data-height={height}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: `${fontPx}px`,
        lineHeight: TEXT_LINE_HEIGHT,
        color: '#202020',
        boxSizing: 'border-box',
        outline: selected ? '2px solid #2563eb' : 'none',
        outlineOffset: 0,
        cursor: editing ? 'text' : 'move',
        touchAction: 'none',
        pointerEvents: 'auto',
      }}
      onPointerDown={genericPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {/* The laid-out display: the same string the stored box was computed
          from, wrapped by the same rules (the box width is the wrap width).
          Hidden while editing, where the editor itself shows the text. */}
      <div
        data-testid={`text-shown-${obj.id}`}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          wordBreak: 'normal',
          visibility: editing && editable ? 'hidden' : 'visible',
          // The text frame owns pointer interaction; the glyphs are display-only.
          pointerEvents: 'none',
        }}
      >
        {text}
      </div>

      {editing && editable && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={width}
          fontFamily={TEXT_FONT_FAMILY}
          lineHeight={TEXT_LINE_HEIGHT}
          testId="text-editor"
          ariaLabel="Text content"
          onInput={sync.remeasureAfterLocalChange}
          onEnd={endEdit}
        />
      )}
    </div>
  );
}
