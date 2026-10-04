/**
 * TextObject component (story 9): renders and edits text objects on the board.
 * Plain text, no fill, no border, no shadow.
 */
import { useCallback, type JSX } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { getTextContent, isEmptyText, deleteIfEmpty } from '../../shared/objects/text';
import { TEXT_SIZES, TEXT_FONT_FAMILY, type TextSize } from '../../shared/config';
import { TextEditor } from './TextEditor';
import { useTextBoxSync } from './useTextBoxSync';
import { createCanvasMeasurer } from './textLayout';
import type { UndoController } from '../board/undo';

interface TextObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
  canEdit: boolean;
  pointerDisabled?: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onDoubleClick: (id: string) => void;
  doc?: Y.Doc;
  onEndEdit?: (next: 'selected' | 'unselected') => void;
  undo?: UndoController | null;
}

// Module-level measurer (created once)
let moduleMeasurer: ReturnType<typeof createCanvasMeasurer> | null = null;
function getMeasurer() {
  if (!moduleMeasurer) {
    moduleMeasurer = createCanvasMeasurer();
  }
  return moduleMeasurer;
}

export function TextObject(props: TextObjectProps): JSX.Element {
  const { obj, selected, editing, canEdit, pointerDisabled, onPointerDown, onDoubleClick, doc, onEndEdit, undo } = props;

  const textObj = obj as ObjectSnapshot & { text: string; size: TextSize; widthMode: 'auto' | 'fixed' };
  const size: TextSize = textObj.size ?? 'M';
  const fontPx = TEXT_SIZES[size];
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;

  const { remeasureAfterLocalChange } = useTextBoxSync({
    doc: doc!,
    id: obj.id,
    measure: getMeasurer(),
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerDisabled) return;
      e.stopPropagation();
      if (!canEdit) return;
      if (editing) return;
      onPointerDown(e, obj.id);
    },
    [canEdit, editing, obj.id, onPointerDown, pointerDisabled],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (pointerDisabled) return;
      e.stopPropagation();
      if (!canEdit) return;
      onDoubleClick(obj.id);
    },
    [canEdit, obj.id, onDoubleClick, pointerDisabled],
  );

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      if (doc) {
        // Check if the object still exists (may have been deleted remotely)
        const objects = doc.getMap('objects');
        if (!objects.has(obj.id)) {
          // Object was deleted remotely - just end editing
          onEndEdit?.(next);
          return;
        }
        // Empty text removal
        if (isEmptyText(doc, obj.id)) {
          deleteIfEmpty(doc, obj.id);
          onEndEdit?.('unselected');
          return;
        }
      }
      onEndEdit?.(next);
    },
    [doc, obj.id, onEndEdit],
  );

  const ytext = doc ? getTextContent(doc, obj.id) : undefined;

  return (
    <div
      role="group"
      aria-label={`Text: ${textObj.text || 'empty'}`}
      data-testid="text-object"
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        cursor: pointerDisabled ? 'text' : 'grab',
        pointerEvents: pointerDisabled ? 'none' : 'auto',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={5000}
          fontPx={fontPx}
          width={width > 0 ? width : 'auto'}
          onInput={remeasureAfterLocalChange}
          onEnd={handleEndEdit}
          undo={undo}
        />
      ) : (
        <div
          data-testid="text-display"
          style={{
            width: '100%',
            height: '100%',
            fontSize: `${fontPx}px`,
            fontFamily: TEXT_FONT_FAMILY,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            color: '#333',
            lineHeight: 1.3,
          }}
        >
          {textObj.text}
        </div>
      )}
    </div>
  );
}
