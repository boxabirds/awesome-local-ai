// Board content: the actual board UI (viewport, toolbar, objects, zoom, hint).
// Extracted from the old App.tsx so BoardPage can render it when ready.
// Story 7: multi-selection, marquee, group move/resize/delete.

import { useCallback, useEffect, useRef } from 'react';
import { BoardViewport, CameraContext } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { installTestHooks } from '../canvas/testHooks';
import { useCamera, useViewportSize } from '../canvas/useCamera';
import { ZoomControls } from '../canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from '../canvas/camera';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { UndoButtons } from '../board/UndoButtons';
import { useUndo } from '../board/useUndo';
import { createUndo, type UndoController } from '../board/undo';
import { getObjectType } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
} from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import { screenToWorld } from '../canvas/camera';

export function BoardContent({ boardId }: { boardId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useViewportSize(rootRef);
  const cameraApi = useCamera(size);
  const { camera, hasNavigated } = cameraApi;
  const setCamera = cameraApi.setCamera;

  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(objects);

  // Editing is disabled when the board failed to load on the server side.
  const canEdit = connectionState !== 'load_failed';

  // Undo controller (story 8): one per board doc, destroyed on board change.
  const undoRef = useRef<UndoController | null>(null);
  useEffect(() => {
    undoRef.current = createUndo(doc);
    return () => { undoRef.current?.destroy(); undoRef.current = null; };
  }, [doc]);
  const undoController = undoRef.current;
  const undoApi = useUndo(undoController, canEdit);
  const boundary = useCallback(() => { undoRef.current?.boundary(); }, []);

  // Shared transform gesture (move/resize) + marquee + keyboard shortcuts.
  const gesture = useTransformGesture({ doc, camera, selection, snapshot: objects, canEdit, onGestureStart: boundary, onGestureEnd: boundary });
  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));
  useBoardKeys({ doc, selection, snapshot: objects, canEdit, onBoundary: boundary, onUndo: undoApi.undo, onRedo: undoApi.redo });

  // Test-only `window.__vidi6` hook (test mode only, see testHooks.ts).
  useEffect(() => {
    installTestHooks(setCamera, () => boardId, () => connectionState);
  }, [setCamera, boardId, connectionState]);

  // Create a sticky note at a screen point (double-click on empty space)
  const handleDblClickEmpty = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (!canEdit) return;
      const world = screenToWorld(camera, screenPoint);
      boundary();
      const id = createSticky(doc, world);
      boundary();
      if (id) {
        // Just created: not in the rendered snapshot yet, so skip validation.
        selection.startEditFresh(id);
      }
    },
    [camera, doc, selection, canEdit, boundary],
  );

  // Create a sticky note at the centre of the viewport (toolbar button)
  const handleCreateSticky = useCallback(() => {
    if (!canEdit) return;
    const centre = { x: size.width / 2, y: size.height / 2 };
    const world = screenToWorld(camera, centre);
    boundary();
    const id = createSticky(doc, world);
    boundary();
    if (id) {
      selection.startEdit(id);
    }
  }, [camera, doc, selection, size, canEdit, boundary]);

  // Clear selection on empty board click
  const handleClickEmpty = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Double-click an object: enter edit mode if the type supports text.
  const handleObjectDoubleClick = useCallback(
    (id: string) => {
      if (!canEdit) return;
      const obj = objects.find((o) => o.id === id);
      if (obj && getObjectType(obj.type)?.editableText) {
        selection.startEdit(id);
      }
    },
    [canEdit, objects, selection],
  );

  // Delete the current selection (SelectionBar / Delete key).
  const handleDeleteSelection = useCallback(() => {
    if (!canEdit || selection.ids.size === 0) return;
    boundary();
    deleteObjects(doc, [...selection.ids]);
    boundary();
    selection.clear();
  }, [canEdit, doc, selection, boundary]);

  const handleStickyColor = useCallback(
    (id: string, color: StickyColor) => {
      if (!canEdit) return;
      boundary();
      setStickyColor(doc, id, color);
      boundary();
    },
    [canEdit, doc, boundary],
  );

  return (
    <CameraContext.Provider value={cameraApi}>
      <div ref={rootRef} className="app-root" data-testid="app-root">
        <BoardViewport
          onDblClickEmpty={handleDblClickEmpty}
          onClickEmpty={handleClickEmpty}
          marquee={marquee}
        >
          {objects.map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null; // unknown type: skip (forward compatibility)
            const Component = spec.Component;
            return (
              <Component
                key={obj.id}
                obj={obj}
                doc={doc}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={selection.editingId === obj.id}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onObjectDoubleClick={handleObjectDoubleClick}
                onEndEdit={selection.endEdit}
                onBoundary={boundary}
                onUndo={undoApi.undo}
                onRedo={undoApi.redo}
              />
            );
          })}
          <MarqueeRect rect={marquee.rect} />
        </BoardViewport>
        <SelectionOverlay
          ids={selection.ids}
          snapshot={objects}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <SelectionBar
          ids={selection.ids}
          snapshot={objects}
          camera={camera}
          onDelete={handleDeleteSelection}
          onStickyColor={handleStickyColor}
        />
        <Toolbar
          onCreateSticky={handleCreateSticky}
          disabled={!canEdit}
          canUndo={undoApi.canUndo}
          canRedo={undoApi.canRedo}
          onUndo={undoApi.undo}
          onRedo={undoApi.redo}
        />
        <ConnectionStatus state={connectionState} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => cameraApi.zoomStep('in')}
          onZoomOut={() => cameraApi.zoomStep('out')}
          onReset={cameraApi.reset}
        />
        <NavigationHint visible={!hasNavigated} />
      </div>
    </CameraContext.Provider>
  );
}
