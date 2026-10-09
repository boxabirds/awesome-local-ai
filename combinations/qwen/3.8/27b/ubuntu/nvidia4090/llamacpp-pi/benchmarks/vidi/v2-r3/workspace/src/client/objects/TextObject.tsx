import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import {
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
} from '../../shared/objects/text';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';
import type { ObjectProps } from './registry';
import { createCanvasMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';

/**
 * Story 9 (text.object): a free text object. The top-left corner is at
 * (x, y); the stored box (width/height) was measured by the client that made
 * the last local change (text.layout). Rendering uses the standard font stack
 * with white-space: pre-wrap so the DOM wraps like the stored layout.
 *
 * Interaction is generic (registry): select by click, move by drag, resize
 * width by the e/w handles, delete, Enter / double-click to edit. While
 * editing, every local input re-measures and writes the box in the same
 * capture window (one undo step restores text and box together). When
 * editing ends with zero characters, the object is removed — an abandoned
 * text never becomes an invisible object.
 */
export function TextObject(props: ObjectProps): ReactElement {
  const { obj, doc, selected, editing, editable } = props;
  const id = obj.id;

  // Type-specific fields live on the doc item (the generic snapshot carries
  // the box); the component re-renders on doc changes.
  const item = doc.getMap('objects').get(id) as Y.Map<any> | undefined;
  const rawSize = item?.get('size');
  const size: TextSize =
    typeof rawSize === 'string' && rawSize in TEXT_SIZES ? (rawSize as TextSize) : DEFAULT_TEXT_SIZE;
  const ytext = getTextContent(doc, id);
  const content = ytext instanceof Y.Text ? ytext.toString() : '';

  const width = typeof obj.width === 'number' && Number.isFinite(obj.width) ? obj.width : 0;
  const height = typeof obj.height === 'number' && Number.isFinite(obj.height) ? obj.height : 0;
  const fontPx = TEXT_SIZES[size];

  const measurer = useMemo(() => createCanvasMeasurer(), []);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, measurer);

  // When editing ends (editing true → false) with zero characters, remove the
  // object entirely. (A remote delete during editing unmounts this component
  // without running the check — nothing to do.)
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing && isEmptyText(doc, id)) {
      deleteIfEmpty(doc, id);
    }
    wasEditing.current = editing;
  }, [editing, doc, id]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (editing) return; // the textarea owns the pointer while editing
    props.onObjectPointerDown(e, id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return; // load_failed: text editing is a no-op
    props.onStartEdit(id);
  };

  // While editing an empty (0×0) text the DOM box gets a one-line minimum so
  // the editor is clickable and visible; the stored box is unchanged.
  const domWidth = Math.max(width, editing ? fontPx : 0);
  const domHeight = Math.max(height, editing ? fontPx * TEXT_LINE_HEIGHT : 0);

  return (
    <div
      role="group"
      data-text-id={id}
      data-object-id={id}
      tabIndex={0}
      {...(selected ? { 'data-selected': 'true' } : {})}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: domWidth,
        height: domHeight,
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: fontPx,
        lineHeight: TEXT_LINE_HEIGHT,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        color: '#23272e',
        outline: selected ? '1.5px solid #1a73e8' : 'none',
        outlineOffset: 1,
        cursor: editing ? 'text' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {content}
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          lineHeight={TEXT_LINE_HEIGHT}
          ariaLabel="Text"
          onInput={remeasureAfterLocalChange}
          onEnd={props.onEndEdit}
          undo={props.undo}
        />
      )}
    </div>
  );
}
