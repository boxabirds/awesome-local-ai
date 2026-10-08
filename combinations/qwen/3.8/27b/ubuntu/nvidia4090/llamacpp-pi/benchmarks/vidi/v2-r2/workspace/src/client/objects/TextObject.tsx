/**
 * One free text object (story 9, text.object): plain text with no
 * background, positioned by top-left, sized by its stored (measured) box.
 *
 * The font size is the size preset (S/M/L/XL); the box is whatever
 * layoutText last measured — the browser renders the same wrapped lines
 * (white-space: pre-wrap at the stored width), so there is no second
 * re-wrap. Selection, move, nudge, delete, marquee and undo come unchanged
 * from stories 7 and 8 via the registry (text.consistent); the object only
 * reports, exactly like the sticky note.
 *
 * While the Text tool is active the object is `inert` (no pointer events):
 * a click falls through to the viewport and creates text on top at that
 * point (text.tool_ui).
 */
import { type JSX } from 'react';
import {
  TEXT_COUNTER_NEAR_CHARS,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../shared/config';
import {
  getTextContent,
  getTextSize,
  type TextSnapshot,
} from '../../shared/objects/text';
import { useTextBoxSync } from './useTextBoxSync';
import { getMeasurer } from './textLayout';
import { TextEditor, TEXT_INK, type TextEditorUndo } from './TextEditor';
import type { ObjectProps } from './registry';

/** The ObjectProps registry contract plus the text-specific fields. */
export type TextObjectProps = ObjectProps;

const NOOP: TextEditorUndo = {
  boundary(): void {},
  undo(): void {},
};

export function TextObject(props: TextObjectProps): JSX.Element {
  const {
    doc,
    obj,
    selected,
    editingId,
    onPointerDown,
    onEdit,
    onEndEdit,
    onTextBoundary,
    onTextUndo,
  } = props;
  const text = obj as TextSnapshot;
  const editing = editingId === obj.id;
  const size = getTextSize(doc, obj.id);
  const fontPx = TEXT_SIZES[size];
  const width =
    typeof text.width === 'number' && text.width > 0 ? text.width : TEXT_MIN_WIDTH_WORLD;
  const height =
    typeof text.height === 'number' && text.height > 0 ? text.height : fontPx * TEXT_LINE_HEIGHT;

  // Automatic box re-measurement after local changes (text.wrap /
  // text.fixed_width): the stored box is a cache of the measured layout.
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, obj.id, getMeasurer());

  const ytext = editing ? (getTextContent(doc, obj.id) ?? null) : null;
  const undo: TextEditorUndo =
    onTextBoundary !== undefined || onTextUndo !== undefined
      ? { boundary: onTextBoundary ?? (() => {}), undo: onTextUndo ?? (() => {}) }
      : NOOP;

  return (
    <div
      data-text-object={obj.id}
      data-object-id={obj.id}
      data-testid="text-object"
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      role="group"
      aria-label="Text"
      tabIndex={0}
      onPointerDown={(e) => {
        if (editing) {
          return; // the textarea owns pointer events while editing (caret)
        }
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // ignore: capture is best-effort
        }
        e.stopPropagation();
        onPointerDown(e, obj.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing) {
          onEdit(obj.id);
        }
      }}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: obj.z,
        fontSize: `${fontPx}px`,
        lineHeight: String(TEXT_LINE_HEIGHT),
        color: TEXT_INK,
        fontFamily: TEXT_FONT_FAMILY,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        boxSizing: 'border-box',
        userSelect: 'none',
        touchAction: 'none',
        pointerEvents: 'auto',
        cursor: editing ? 'text' : 'grab',
      }}
    >
      {editing && ytext !== null ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width="auto"
          onInput={remeasureAfterLocalChange}
          onEnd={onEndEdit}
          undo={undo}
          ui={{
            ariaLabel: 'Text',
            textareaTestid: 'text-textarea',
            counterNear: TEXT_COUNTER_NEAR_CHARS,
          }}
        />
      ) : (
        <div
          data-testid="text-object-content"
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {text.text}
        </div>
      )}
    </div>
  );
}
