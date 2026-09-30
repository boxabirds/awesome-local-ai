import type { ReactElement } from 'react';
import type { ObjectSnapshot } from '@shared/board-model';
import type { ImageSnap } from '@shared/objects/image';
import type { SelectionApi } from '@client/board/useSelection';
import type { UndoController } from '@client/board/undo';
import { ImageObjectWrapper } from './ImageObject';

export interface ImageLayerProps {
  notes: readonly ObjectSnapshot[];
  doc: import('yjs').Doc;
  selection: SelectionApi;
  editable: boolean;
  onObjectPointerDown(e: PointerEvent, id: string): void;
  identityId: string;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  onRetry(id: string): void;
  undoController?: UndoController | null;
}

export function ImageLayer({
  notes,
  doc,
  selection,
  onObjectPointerDown,
  identityId,
  progress,
  canRetry,
  onRetry,
}: ImageLayerProps): ReactElement {
  const imageObjects = notes.filter((n) => n.type === 'image') as ImageSnap[];

  return (
    <>
      {imageObjects.map((img) => (
        <ImageObjectWrapper
          key={img.id}
          obj={img}
          selected={selection.ids.has(img.id)}
          editing={false}
          editable={false}
          zoom={1}
          onPointerDown={onObjectPointerDown}
          onStartEdit={() => {}}
          onEndEdit={() => {}}
          identityId={identityId}
          progress={progress.get(img.id)}
          canRetry={canRetry(img.id)}
          onRetry={() => onRetry(img.id)}
          doc={doc}
        />
      ))}
    </>
  );
}
