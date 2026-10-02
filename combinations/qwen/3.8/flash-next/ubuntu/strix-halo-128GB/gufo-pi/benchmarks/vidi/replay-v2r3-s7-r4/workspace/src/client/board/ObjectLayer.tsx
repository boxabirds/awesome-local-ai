import React from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { getObjectType } from '../objects/registry';

export interface ObjectLayerProps {
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  camera: Camera;
  selectedIds: ReadonlySet<string>;
  editingId: string | null;
  draggingIds: ReadonlySet<string>;
  editable: boolean;
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/**
 * Draws every known board object through the registry (sel.all_types). Objects
 * of an unregistered type render an inert placeholder and are never selectable
 * (TC-08 / sel.all_types "a type with no registration is not selectable").
 */
export function ObjectLayer({
  snapshot,
  doc,
  camera,
  selectedIds,
  editingId,
  draggingIds,
  editable,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectLayerProps) {
  const soleId = selectedIds.size === 1 ? [...selectedIds][0] : null;
  return (
    <>
      {snapshot.map((obj) => {
        const spec = getObjectType(obj.type);
        if (!spec) {
          return (
            <div
              key={obj.id}
              data-unknown-type={obj.type}
              data-note-id={obj.id}
              style={{ position: 'absolute', left: obj.x, top: obj.y, width: 40, height: 40 }}
            />
          );
        }
        const Component = spec.Component;
        return (
          <Component
            key={obj.id}
            obj={obj}
            doc={doc}
            camera={camera}
            selected={selectedIds.has(obj.id)}
            editing={editingId === obj.id}
            dragging={draggingIds.has(obj.id)}
            editable={editable}
            isSoleSelected={soleId === obj.id}
            onObjectPointerDown={onObjectPointerDown}
            onStartEdit={onStartEdit}
            onEndEdit={onEndEdit}
          />
        );
      })}
    </>
  );
}
