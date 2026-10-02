import { useRef, useEffect } from 'react';
import {
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
  type TextSize,
} from '../../shared/config';
import { getTextContent, isEmptyText, deleteIfEmpty, type TextSnapshot } from '../../shared/objects/text';
import { useTextBoxSync } from './useTextBoxSync';
import { createCanvasMeasurer } from './textLayout';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

/**
 * Story 9 (text.object): renders a text object on the board.
 *
 * - Plain text, no background, at x/y with stored width/height.
 * - `white-space: pre-wrap`, font TEXT_SIZES[size].
 * - Double-click or Enter (single selection, canEdit) starts editing.
 * - While editing: shows the TextEditor.
 * - Edit end: calls deleteIfEmpty (empty → removed, selection cleared).
 * - Remote deletion during editing: the object is pruned from the snapshot,
 *   which unmounts this component (the selection reducer handles it).
 */
export function TextObject({
  obj,
  doc,
  selected,
  editing,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undo,
}: ObjectProps): React.ReactElement {
  const note = obj as TextSnapshot;
  const id = note.id;
  const width = note.width ?? 100;
  const height = note.height ?? 20;
  const size = (note.size ?? 'M') as TextSize;
  const fontPx = TEXT_SIZES[size];

  const containerRef = useRef<HTMLDivElement>(null);
  const onObjectPointerDownRef = useRef(onObjectPointerDown);
  onObjectPointerDownRef.current = onObjectPointerDown;
  const onStartEditRef = useRef(onStartEdit);
  onStartEditRef.current = onStartEdit;

  // Box sync: remeasure after local changes.
  const measureRef = useRef(createCanvasMeasurer());
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, measureRef.current);

  // Pointer interaction: native listeners so stopPropagation runs before
  // the board viewport's native pan listener.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onObjectPointerDownRef.current(e, id);
    };
    const onDoubleClick = (e: MouseEvent) => {
      e.stopPropagation();
      onStartEditRef.current(id);
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, [id]);

  const text = getTextContent(doc, id);

  // Handle edit end: check if empty and delete if so.
  const handleEndEdit = (next: 'selected' | 'unselected') => {
    if (isEmptyText(doc, id)) {
      deleteIfEmpty(doc, id);
    }
    onEndEdit(next);
  };

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={note.text || 'Text'}
      data-testid={`text-object-${id}`}
      data-selected={selected || undefined}
      data-size={size}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        zIndex: note.z,
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
        cursor: editing ? 'text' : 'inherit',
      }}
    >
      {editing && text ? (
        <TextEditor
          ytext={text}
          maxChars={5000}
          fontPx={fontPx}
          width="auto"
          onInput={remeasureAfterLocalChange}
          onEnd={handleEndEdit}
          undo={undo}
        />
      ) : (
        <div
          data-testid={`text-content-${id}`}
          aria-label="Text content"
          style={{
            width: '100%',
            height: '100%',
            fontSize: fontPx,
            fontFamily: TEXT_FONT_FAMILY,
            lineHeight: 1.3,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            pointerEvents: 'none',
            color: '#222',
          }}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}
