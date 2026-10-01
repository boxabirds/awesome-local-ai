// src/client/objects/TextObject.tsx
// Renders and edits text objects on the board.

import { useCallback } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { getTextContent } from '../../shared/objects/text';
import { TEXT_SIZES, TEXT_FONT_FAMILY, type TextSize } from '../../shared/config';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

export interface TextObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onPointerDown: (e: ReactPointerEvent, id: string) => void;
  onDblClick: (e: React.MouseEvent, id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  undo?: UndoController;
}

export function TextObject(props: TextObjectProps): ReactElement {
  const { obj, doc, selected, editing, onPointerDown, onDblClick, onEndEdit, undo } = props;

  const x = obj.x;
  const y = obj.y;
  const width = (obj as any).width ?? 100;
  const height = (obj as any).height ?? 30;
  const size = ((obj as any).size ?? 'M') as TextSize;
  const text = (obj as any).text ?? '';
  const fontSize = TEXT_SIZES[size];

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    if (editing) return;
    onPointerDown(e, obj.id);
  }, [editing, obj.id, onPointerDown]);

  const handleDblClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editing) {
      onDblClick(e, obj.id);
    }
  }, [editing, obj.id, onDblClick]);

  const ytext = getTextContent(doc, obj.id);

  return (
    <div
      role="group"
      aria-label={text ? `Text: ${text}` : 'Text'}
      data-selected={selected || undefined}
      data-testid={`text-object-${obj.id}`}
      data-text-object="true"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        background: 'transparent',
        outline: selected ? '2px solid #2196F3' : 'none',
        outlineOffset: 2,
        cursor: 'grab',
        userSelect: 'none',
        overflow: 'visible',
      }}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={5000}
          fontPx={fontSize}
          width={width}
          onInput={undefined}
          onEnd={onEndEdit}
          undo={undo}
        />
      ) : (
        <div
          data-testid="text-content"
          style={{
            width: '100%',
            height: '100%',
            fontSize: fontSize,
            fontFamily: TEXT_FONT_FAMILY,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            lineHeight: 1.3,
            color: '#222',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
