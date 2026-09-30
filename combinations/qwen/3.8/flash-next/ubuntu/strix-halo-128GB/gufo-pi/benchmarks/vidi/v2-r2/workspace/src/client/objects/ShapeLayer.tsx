import type { ReactElement } from 'react';
import { useBoard } from '@client/canvas/BoardContext';
import { ShapeObject } from './ShapeObject';
import type { ObjectSnapshot } from '@shared/board-model';
import type { ShapeSnap } from '@shared/objects/shape';
import type * as Y from 'yjs';
import type { SelectionApi } from '@client/board/useSelection';
import type { UndoController } from '@client/board/undo';

interface ShapeLayerProps {
  notes: readonly ObjectSnapshot[];
  doc: Y.Doc;
  selection: SelectionApi;
  editable: boolean;
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
}

export function ShapeLayer({
  notes,
  doc,
  selection,
  editable,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undoController,
}: ShapeLayerProps): ReactElement {
  const { camera } = useBoard();
  const shapes = notes.filter((n): n is ShapeSnap => n.type === 'shape');
  return (
    <>
      {shapes.map((shape) => (
        <ShapeObject
          key={shape.id}
          shape={shape}
          doc={doc}
          zoom={camera.zoom}
          selected={selection.ids.has(shape.id)}
          editing={shape.id === selection.editingId}
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
