import { useCallback } from 'react';
import type * as Y from 'yjs';
import type { TextObjectSnapshot } from '../../shared/board-model';
import { getTextContent } from '../../shared/objects/text';
import { deleteIfEmpty } from '../../shared/objects/text';
import { TEXT_FONT_FAMILY, TEXT_SIZES, TEXT_MAX_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';
import { createCanvasMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import type { UndoController } from '../board/undo';

export interface TextObjectProps {
  obj: TextObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable?: boolean;
  onSelect(id: string): void;
  onToggleSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
  onObjectPointerDown?(e: PointerEvent, id: string): void;
  onClearSelection?(): void;
  undoController?: UndoController | null;
}

const measure = createCanvasMeasurer();

export function TextObject(props: TextObjectProps) {
  const {
    obj, doc, selected, editing, editable = true,
    onSelect, onToggleSelect, onStartEdit, onEndEdit,
    onObjectPointerDown, onClearSelection, undoController,
  } = props;

  const { remeasureAfterLocalChange } = useTextBoxSync(doc, obj.id, measure);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      if (editing) return;
      if (!editable) return;
      if (e.shiftKey) {
        onToggleSelect(obj.id);
        return;
      }
      if (onObjectPointerDown) {
        onObjectPointerDown(e.nativeEvent as unknown as PointerEvent, obj.id);
      } else {
        onSelect(obj.id);
      }
    },
    [editing, editable, obj.id, onSelect, onToggleSelect, onObjectPointerDown],
  );

  const handleDblClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!editable) return;
      onSelect(obj.id);
      onStartEdit(obj.id);
    },
    [obj.id, onSelect, onStartEdit, editable],
  );

  const handleEndEdit = useCallback(
    (_next: 'selected' | 'unselected') => {
      // Check if text is empty -> delete
      const wasDeleted = deleteIfEmpty(doc, obj.id);
      if (wasDeleted) {
        if (onClearSelection) onClearSelection();
        return;
      }
      onEndEdit();
    },
    [doc, obj.id, onEndEdit, onClearSelection],
  );

  const handleInput = useCallback(() => {
    remeasureAfterLocalChange();
  }, [remeasureAfterLocalChange]);

  const ytext = editing ? getTextContent(doc, obj.id) : undefined;
  const fontPx = TEXT_SIZES[obj.size];

  return (
    <div
      className={`text-object${selected ? ' text-selected' : ''}`}
      data-testid={`text-object-${obj.id}`}
      data-note-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label={obj.text || 'Empty text'}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: fontPx,
        lineHeight: 1.3,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        outline: selected ? '2px solid #2563eb' : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : 'grab',
        zIndex: obj.z,
        userSelect: editing ? 'text' : 'none',
        padding: 0,
        margin: 0,
        boxSizing: 'border-box',
        color: '#0f172a',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={obj.widthMode === 'fixed' ? obj.width : 'auto'}
          onInput={handleInput}
          onEnd={handleEndEdit}
          undoController={undoController}
          testId="text-object-textarea"
        />
      ) : (
        <div
          data-testid={`text-content-${obj.id}`}
          style={{
            fontSize: fontPx,
            lineHeight: 1.3,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
          }}
        >
          {obj.text}
        </div>
      )}
    </div>
  );
}
