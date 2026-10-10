// The board UI (viewport, toolbar, objects, selection machinery, sync badge).
// Story 7: multi-selection, group transform gestures, marquee, keyboard
// commands, the selection overlay and the selection bar are wired here.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BoardViewport, type ViewportHandle } from '../canvas/BoardViewport';
import { installTestHook } from '../canvas/testHooks';
import type { Camera } from '../canvas/camera';
import { useBoardDoc } from '../board/useBoardDoc';
import { seedBoard } from '../board/seedBoard';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import type { Point } from '../canvas/camera';

// Editing is disabled only while the board could not be loaded: every other
// state (connecting, reconnecting, confirmed) keeps the board editable.
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function BoardScreen({ boardId }: { boardId: string }) {
  const { doc, objects, connection } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  const [viewport, setViewport] = useState<ViewportHandle | null>(null);
  const [gestureActive, setGestureActive] = useState(false);

  // Test-only: expose the live doc, note snapshot and connection state for
  // e2e assertions. Gated by mode so seed code and hooks are dead-code
  // eliminated from production builds.
  if (import.meta.env.MODE === 'test') {
    useEffect(() => {
      installTestHook({
        board: { doc, getNotes: () => snapshot(doc), seedBoard: (count) => seedBoard(doc, count) },
        connectionState: () => connection,
      });
    }, [doc, connection]);
  }

  const editable = canEdit(connection);
  const camera = viewport?.camera ?? DEFAULT_CAMERA;

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => setGestureActive(true),
    onGestureEnd: () => setGestureActive(false),
  });

  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable });

  const createStickyAtWorld = useCallback(
    (world: Point) => {
      if (!editable) return; // load_failed: creation is a no-op
      // createSticky takes the note centre, so the note lands centred here.
      const id = createSticky(doc, world);
      // Creation immediately starts editing with an empty caret (FR-4).
      if (typeof id === 'string') selection.startEdit(id);
    },
    [doc, selection, editable],
  );

  const createStickyAtCentre = useCallback(() => {
    if (!viewport) return;
    createStickyAtWorld(viewport.centerWorld());
  }, [viewport, createStickyAtWorld]);

  const deleteSelection = useCallback(() => {
    if (!editable || selection.ids.size === 0) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, editable]);

  const changeColor = useCallback(
    (id: string, color: StickySnapshot['color']) => {
      if (!editable) return;
      setStickyColor(doc, id, color);
    },
    [doc, editable],
  );

  // Render in stable creation order (never re-sorted by z) so bringToFront
  // mid-drag cannot detach the dragged node and break pointer capture; the
  // object's z-index carries the stacking order instead.
  const orderedObjects = useMemo(
    () => [...objects].sort((a, b) => a.createdAt - b.createdAt),
    [objects],
  );

  const zoom = camera.zoom;

  return (
    <>
      <ConnectionStatus state={connection} />
      <Toolbar onCreateSticky={createStickyAtCentre} disabled={!editable} />
      <BoardViewport
        onCreateStickyAtWorld={createStickyAtWorld}
        onClearSelection={selection.clear}
        onViewportHandle={setViewport}
        snapshot={objects}
        onMarqueeSelect={(ids) => selection.setMany(ids, true)}
        overlay={
          <SelectionOverlay
            ids={selection.ids}
            snapshot={objects}
            camera={camera}
            onHandlePointerDown={gesture.onHandlePointerDown}
          />
        }
      >
        {orderedObjects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null;
          const Component = spec.Component;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              editable={editable}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={(next) => {
                selection.endEdit();
                if (next === 'unselected') selection.clear();
              }}
            />
          );
        })}
        <SelectionBar
          ids={selection.ids}
          snapshot={objects}
          onDelete={deleteSelection}
          suppress={gestureActive || selection.editingId !== null}
          onColor={changeColor}
        />
      </BoardViewport>
    </>
  );
}
