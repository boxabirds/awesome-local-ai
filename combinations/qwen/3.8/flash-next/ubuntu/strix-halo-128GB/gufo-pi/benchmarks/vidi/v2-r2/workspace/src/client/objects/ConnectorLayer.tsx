import type { ReactElement } from 'react';
import { useBoard } from '@client/canvas/BoardContext';
import { ConnectorObject } from './ConnectorObject';
import type { ObjectSnapshot } from '@shared/board-model';
import { objectBounds } from '@shared/board-model';
import type { ConnectorSnap } from '@shared/objects/connector';
import type { Rect } from '@shared/geometry';
import type * as Y from 'yjs';
import type { SelectionApi } from '@client/board/useSelection';

interface ConnectorLayerProps {
  notes: readonly ObjectSnapshot[];
  doc: Y.Doc;
  selection: SelectionApi;
  onConnectorHandlePointerDown?(e: PointerEvent, id: string, end: 'from' | 'to'): void;
}

export function ConnectorLayer({
  notes,
  doc,
  selection,
  onConnectorHandlePointerDown,
}: ConnectorLayerProps): ReactElement {
  const { camera } = useBoard();
  const connectors = notes.filter((n): n is ConnectorSnap => n.type === 'connector');

  // Build rects map for connector endpoint resolution
  const rects = new Map<string, Rect>();
  for (const obj of notes) {
    if (obj.type === 'connector') continue;
    rects.set(obj.id, objectBounds(obj));
  }

  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
      data-testid="connector-layer"
    >
      {connectors.map((c) => (
        <g key={c.id} style={{ pointerEvents: 'auto' }}>
          <ConnectorObject
            connector={c}
            rects={rects}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(c.id)}
            camera={camera}
            onHandlePointerDown={onConnectorHandlePointerDown}
          />
        </g>
      ))}
    </svg>
  );
}
