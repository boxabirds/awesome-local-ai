import { useMemo, useEffect, type JSX } from 'react';
import * as Y from 'yjs';
import { TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_FONT_FAMILY, TEXT_PADDING_WORLD, TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
  type TextSnapshot,
} from '../../shared/objects/text';
import { createCanvasMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

/**
 * Renders and edits a free text object (story 9, text.object).
 *
 * The box (width/height) is stored in the Y.Doc and measured by THIS client
 * after local changes (key decision 1); remote clients render the stored
 * box without re-measuring.
 */
export function TextObjectComponent(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, editable, onPointerDown, onStartEdit, onEndEdit, undo, onClearSelection } = props;

  const text = obj as TextSnapshot;
  const fontPx = TEXT_SIZES[text.size];
  const width = text.width ?? 0;
  const height = text.height ?? 0;

  // One canvas measurer per object (falls back to an estimate without canvas)
  const measure = useMemo(() => createCanvasMeasurer(), []);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, text.id, measure);

  // Remeasure after any LOCAL schema change (size preset from the toolbar,
  // fixed width from a handle drag) in the same capture window (key decision
  // 1). Remote changes never trigger a write.
  useEffect(() => {
    const obj = doc.getMap('objects').get(text.id);
    if (!(obj instanceof Y.Map)) return;
    // observeDeep passes the Yjs Transaction as the second argument; the
    // transaction origin (LOCAL_ORIGIN for this client's own changes) lives
    // on `transaction.origin`.
    const handler = (_events: unknown, transaction: { origin?: unknown }) => {
      if (transaction?.origin !== LOCAL_ORIGIN) return;
      remeasureAfterLocalChange();
    };
    obj.observeDeep(handler);
    return () => obj.unobserveDeep(handler);
  }, [doc, text.id, remeasureAfterLocalChange]);

  const ytext = getTextContent(doc, text.id);

  // Ending an edit: remove the object if it ended empty (text.empty) INSIDE
  // the typing burst window so one undo restores the text, then close the
  // capture window and leave edit mode.
  const handleEndEdit = (_next: 'selected' | 'unselected') => {
    if (isEmptyText(doc, text.id)) {
      if (deleteIfEmpty(doc, text.id)) {
        onClearSelection?.(text.id);
      }
    }
    undo?.boundary();
    onEndEdit();
  };

  return (
    <div
      role="group"
      aria-label="Text"
      data-testid={`text-object-${text.id}`}
      data-note-id={text.id}
      data-object-type="text"
      data-selected={selected || undefined}
      tabIndex={0}
      onPointerDown={(e) => {
        if (editing) return;
        if (!editable) {
          e.stopPropagation();
          return;
        }
        onPointerDown(e, text.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editable) return;
        onStartEdit(text.id);
      }}
      style={{
        position: 'absolute',
        left: text.x,
        top: text.y,
        width: Math.max(width, 1),
        minHeight: Math.max(height, 1),
        outline: selected ? '3px solid #2196F3' : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : 'text',
        boxSizing: 'border-box',
      }}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={text.widthMode === 'fixed' ? width : 'auto'}
          onInput={remeasureAfterLocalChange}
          onEnd={handleEndEdit}
          undo={undo}
          padding={TEXT_PADDING_WORLD / 2}
          dataTestId="text-editor"
        />
      ) : (
        <div
          data-testid="text-display"
          style={{
            width: '100%',
            fontSize: `${fontPx}px`,
            fontFamily: TEXT_FONT_FAMILY,
            lineHeight: TEXT_LINE_HEIGHT,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            padding: `0 ${TEXT_PADDING_WORLD / 2}px`,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        >
          {text.text}
        </div>
      )}
    </div>
  );
}

// Keep the contract name from the design doc
export { TextObjectComponent as TextObject };
