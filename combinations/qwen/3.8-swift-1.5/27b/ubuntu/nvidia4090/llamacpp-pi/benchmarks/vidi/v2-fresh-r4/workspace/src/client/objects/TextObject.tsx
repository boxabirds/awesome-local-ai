/**
 * Text object component (story 9): renders a text object's box — plain text
 * with no background, four size presets, auto (content-driven) or fixed
 * (user-resized) width. While editing, hosts the TextEditor.
 *
 * The stored box (width/height) is kept in sync by useTextBoxSync, which
 * writes only after local changes (key decision 1: no write races).
 */
import { useMemo, type JSX } from 'react';
import * as Y from 'yjs';
import { TEXT_SIZES, type TextSize } from '../../shared/config';
import { getTextContent } from '../../shared/objects/text';
import type { ObjectProps } from './registry';
import { createCanvasMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';

export interface TextObjectProps extends ObjectProps {
  /** The Y.Doc for text editing and box sync. */
  doc?: Y.Doc;
  /** Called when editing ends (with the object id). */
  onEndEdit?: (id: string) => void;
  /** Close the current undo step (editing start/end) — story 8. */
  onBoundary?: () => void;
  /** Undo (Ctrl/Cmd+Z inside the editor) — story 8. */
  onUndo?: () => void;
  /** Redo (Ctrl/Cmd+Shift+Z, Ctrl+Y inside the editor) — story 8. */
  onRedo?: () => void;
}

/**
 * Text object. Delegates pointer events to the transform gesture (move, and
 * for fixed-width text the horizontal resize handles).
 */
export function TextObject(props: TextObjectProps): JSX.Element {
  const { obj, selected, editing, onPointerDown, onDoubleClick, doc, onEndEdit, onBoundary, onUndo, onRedo } = props;
  const id = obj.id;
  const text = (obj as { text?: string }).text ?? '';
  const size = (obj as { size?: TextSize }).size ?? 'M';
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;

  const measure = useMemo(() => createCanvasMeasurer(), []);
  useTextBoxSync(doc, id, measure);

  const ytext = editing && doc ? getTextContent(doc, id) : undefined;

  return (
    <div
      className={`text-object text-size-${size}${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}`}
      data-vidi6="text"
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        // Always render the stored box: in auto mode the width is the
        // measured content width, in fixed mode it is the user-set width.
        width: `${width}px`,
        height: `${height}px`,
        fontSize: `${TEXT_SIZES[size]}px`,
        zIndex: obj.z,
      }}
      onPointerDown={(e) => {
        if (editing) return; // Don't start drag while editing
        onPointerDown(e, id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick(e, id);
      }}
    >
      {editing && ytext && doc ? (
        <TextEditor
          doc={doc}
          id={id}
          ytext={ytext}
          size={size}
          onEndEdit={onEndEdit ?? (() => {})}
          onBoundary={onBoundary ?? (() => {})}
          onUndo={onUndo ?? (() => {})}
          onRedo={onRedo ?? (() => {})}
        />
      ) : (
        <span
          className="text-content"
          data-vidi6="text-content"
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {text}
        </span>
      )}
    </div>
  );
}
