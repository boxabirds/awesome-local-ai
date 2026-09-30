import type { ReactElement } from 'react';
import { useBoard } from '@client/canvas/BoardContext';
import { TextObject } from './TextObject';
import type { ObjectSnapshot, TextObjectSnapshot } from '@shared/board-model';
import type * as Y from 'yjs';
import type { SelectionApi } from '@client/board/useSelection';
import type { UndoController } from '@client/board/undo';

interface TextLayerProps {
  notes: readonly ObjectSnapshot[];
  doc: Y.Doc;
  selection: SelectionApi;
  editable: boolean;
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
}

export function TextLayer({
  notes,
  doc,
  selection,
  editable,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undoController,
}: TextLayerProps): ReactElement {
  const { camera } = useBoard();
  const textObjects = notes.filter((n): n is TextObjectSnapshot => n.type === 'text');
  return (
    <>
      {textObjects.map((textObj) => (
        <TextObject
          key={textObj.id}
          textObj={textObj}
          doc={doc}
          zoom={camera.zoom}
          selected={selection.ids.has(textObj.id)}
          editing={textObj.id === selection.editingId}
          editable={editable}
          onObjectPointerDown={onObjectPointerDown}
          onStartEdit={onStartEdit}
          onEndEdit={onEndEdit}
          undoController={undoController}
        />
      ))}
    </>
  );
}
