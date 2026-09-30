import type { ReactElement } from 'react';
import type { ObjectSnapshot } from '@shared/board-model';
import type { StrokeSnap } from '@shared/objects/stroke';
import { StrokeObject } from './StrokeObject';
import type { SelectionApi } from '@client/board/useSelection';
import { useBoard } from '@client/canvas/BoardContext';

interface StrokeLayerProps {
  notes: readonly ObjectSnapshot[];
  selection: SelectionApi;
  onObjectPointerDown(e: PointerEvent, id: string): void;
}

export function StrokeLayer({ notes, selection, onObjectPointerDown }: StrokeLayerProps): ReactElement {
  const { camera } = useBoard();
  const strokes = notes.filter((n): n is StrokeSnap => n.type === 'stroke');
  return (
    <>
      {strokes.map((stroke) => (
        <StrokeObject
          key={stroke.id}
          stroke={stroke}
          selected={selection.ids.has(stroke.id)}
          zoom={camera.zoom}
          onObjectPointerDown={onObjectPointerDown}
        />
      ))}
    </>
  );
}
