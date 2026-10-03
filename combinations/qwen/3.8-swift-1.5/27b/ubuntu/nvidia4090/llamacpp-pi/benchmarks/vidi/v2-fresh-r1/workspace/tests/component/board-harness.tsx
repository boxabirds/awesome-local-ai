// Shared board harness for component tests (story 7 architecture):
// viewport + marquee + registry-rendered objects + selection overlay +
// selection bar + transform gesture + board keyboard shortcuts.

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { BoardViewport, CameraContext } from '../../src/client/canvas/BoardViewport';
import { useCamera } from '../../src/client/canvas/useCamera';
import type { Size } from '../../src/client/canvas/camera';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useMarquee, MarqueeRect } from '../../src/client/board/Marquee';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../src/client/board/SelectionBar';
import { getObjectType } from '../../src/client/objects/registry';

/** Viewport size used by the harness (default laptop). */
export const HARNESS_SIZE: Size = { width: 1280, height: 800 };

/** Subscribe to a Y.Doc's objects map; returns the current snapshot. */
export function useDocSnapshot(
  doc: Y.Doc,
  snapshotOfDoc?: (doc: Y.Doc) => readonly ObjectSnapshot[],
): readonly ObjectSnapshot[] {
  const take = snapshotOfDoc ?? snapshot;
  const [snap, setSnap] = useState(() => take(doc));
  useEffect(() => {
    const objects = doc.getMap('objects');
    const handler = () => setSnap(take(doc));
    objects.observeDeep(handler);
    return () => objects.unobserveDeep(handler);
  }, [doc, take]);
  return snap;
}

export function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  return doc;
}

export function BoardHarness(props: {
  doc: Y.Doc;
  /** Set false to simulate a load-failed board (editing locked). */
  canEdit?: boolean;
  /** Test-only: snapshot override (e.g. to include fixture object types). */
  snapshotOfDoc?: (doc: Y.Doc) => readonly ObjectSnapshot[];
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}) {
  const { doc, canEdit = true, snapshotOfDoc, onGestureStart, onGestureEnd } = props;
  const api = useCamera(HARNESS_SIZE);
  const objects = useDocSnapshot(doc, snapshotOfDoc);
  const selection = useSelection(objects);

  const gesture = useTransformGesture({
    doc,
    camera: api.camera,
    selection,
    snapshot: objects,
    canEdit,
    onGestureStart,
    onGestureEnd,
  });
  const marquee = useMarquee(api.camera, objects, (ids) => selection.setMany(ids, true));
  useBoardKeys({ doc, selection, snapshot: objects, canEdit });

  const handleDblClickEmpty = (pt: { x: number; y: number }) => {
    const world = screenToWorld(api.camera, pt);
    const id = createSticky(doc, world);
    if (id) selection.startEdit(id);
  };

  const handleDeleteSelection = () => {
    if (selection.ids.size === 0) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  };

  const handleObjectDoubleClick = (id: string) => {
    const obj = objects.find((o) => o.id === id);
    if (obj && getObjectType(obj.type)?.editableText) selection.startEdit(id);
  };

  return (
    <CameraContext.Provider value={api}>
      <div>
        <BoardViewport
          onDblClickEmpty={handleDblClickEmpty}
          onClickEmpty={() => selection.clear()}
          marquee={marquee}
        >
          {objects.map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null;
            const Component = spec.Component;
            return (
              <Component
                key={obj.id}
                obj={obj}
                doc={doc}
                zoom={api.camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={selection.editingId === obj.id}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onObjectDoubleClick={handleObjectDoubleClick}
                onEndEdit={selection.endEdit}
              />
            );
          })}
          <MarqueeRect rect={marquee.rect} />
        </BoardViewport>
        <SelectionOverlay
          ids={selection.ids}
          snapshot={objects}
          camera={api.camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <SelectionBar
          ids={selection.ids}
          snapshot={objects}
          camera={api.camera}
          onDelete={handleDeleteSelection}
          onStickyColor={(id, c: StickyColor) => setStickyColor(doc, id, c)}
        />
        <div data-testid="selected" data-value={[...selection.ids].sort().join(',')} />
        <div data-testid="editing" data-value={selection.editingId ?? ''} />
        <div data-testid="note-count" data-value={String(objects.length)} />
        <div data-testid="camera-x" data-value={String(api.camera.x)} />
        <div data-testid="camera-y" data-value={String(api.camera.y)} />
      </div>
    </CameraContext.Provider>
  );
}
