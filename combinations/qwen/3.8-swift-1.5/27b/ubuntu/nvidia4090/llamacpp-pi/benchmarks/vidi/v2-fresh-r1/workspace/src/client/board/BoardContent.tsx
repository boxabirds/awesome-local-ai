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
import { useTool } from '../board/useTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { createShape } from '../../shared/objects/shape';
import { createConnector } from '../../shared/objects/connector';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config';
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
import { createText, deleteIfEmpty, isEmptyText, setTextSize } from '../../shared/objects/text';
import { setShapeStyle } from '../../shared/objects/shape';
import type { StickyColor, TextSize, FillColor, StrokeColor } from '../../shared/config';
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

  // Active tool (story 9+): select (default), text, shape, connector, pen.
  const { tool, shapeKind, setTool, setShapeKind, toolCreated, onToolCreated } = useTool(canEdit);
  const penOptions = usePenOptions();

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

  // Kept in a ref so the key handler (which runs once) always sees the
  // latest create-sticky callback without a dependency cycle.
  const handleCreateStickyRef = useRef<() => void>(() => {});
  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit,
    tool,
    setTool,
    onCreateSticky: handleCreateStickyRef.current,
    onBoundary: boundary,
    onUndo: undoApi.undo,
    onRedo: undoApi.redo,
  });

  // Test-only `window.__vidi6` hook (test mode only, see testHooks.ts).
  useEffect(() => {
    installTestHooks(setCamera, () => boardId, () => connectionState);
  }, [setCamera, boardId, connectionState]);

  // Create a sticky note at a screen point (double-click on empty space)
  const handleDblClickEmpty = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (!canEdit) return;
      if (tool === 'text') return; // the Text tool creates text, not stickies
      const world = screenToWorld(camera, screenPoint);
      boundary();
      const id = createSticky(doc, world);
      boundary();
      if (id) {
        // Just created: not in the rendered snapshot yet, so skip validation.
        selection.startEditFresh(id);
      }
    },
    [camera, doc, selection, canEdit, boundary, tool],
  );

  // Create a sticky note at the centre of the viewport (toolbar button / N)
  const handleCreateSticky = useCallback(() => {
    if (!canEdit) return;
    const centre = { x: size.width / 2, y: size.height / 2 };
    const world = screenToWorld(camera, centre);
    boundary();
    const id = createSticky(doc, world);
    boundary();
    if (id) {
      // Just created: not in the rendered snapshot yet (skip validation).
      selection.startEditFresh(id);
    }
  }, [camera, doc, selection, size, canEdit, boundary]);

  handleCreateStickyRef.current = handleCreateSticky;

  // Story 11: a stroke click that misses its line selects the object
  // underneath (topmost whose hit test passes), else clears the selection.
  const handleObjectMiss = useCallback(
    (e: React.PointerEvent<Element>, missedId: string) => {
      const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        if (o.id === missedId) continue;
        const spec = getObjectType(o.type);
        if (spec && spec.hitTest(o, world, camera.zoom)) {
          selection.click(o.id);
          return;
        }
      }
      selection.clear();
    },
    [camera, objects, selection],
  );

  // Create a text object at a screen point (Text tool click, story 9).
  const handleCreateText = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (!canEdit) return;
      const world = screenToWorld(camera, screenPoint);
      boundary();
      const id = createText(doc, world, 'local');
      boundary();
      if (id) {
        setTool('select');
        // Just created: not in the rendered snapshot yet, so skip validation.
        selection.startEditFresh(id);
      }
    },
    [camera, doc, selection, canEdit, boundary, setTool],
  );

  // Register the selection callback for toolCreated (story 10).
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    onToolCreated((id: string) => {
      queueMicrotask(() => {
        selectionRef.current.setMany([id], false);
      });
    });
  }, [onToolCreated]);

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

  // End editing a text object (story 9): an empty text is deleted and the
  // selection cleared; otherwise the selection is kept.
  const handleTextEditEnd = useCallback(() => {
    const id = selection.editingId;
    if (id === null) return;
    if (isEmptyText(doc, id)) {
      boundary();
      deleteIfEmpty(doc, id);
      boundary();
      selection.clear();
    } else {
      selection.endEdit();
    }
  }, [doc, selection, boundary]);

  // Change the size of a text object (TextToolbar, story 9).
  const handleTextSize = useCallback(
    (id: string, size: TextSize) => {
      if (!canEdit) return;
      boundary();
      setTextSize(doc, id, size);
      boundary();
    },
    [canEdit, doc, boundary],
  );

  // Change the style of a shape (ShapeToolbar, story 10).
  const handleShapeFill = useCallback(
    (id: string, fill: FillColor) => {
      if (!canEdit) return;
      boundary();
      setShapeStyle(doc, id, { fill });
      boundary();
    },
    [canEdit, doc, boundary],
  );

  const handleShapeStroke = useCallback(
    (id: string, stroke: StrokeColor) => {
      if (!canEdit) return;
      boundary();
      setShapeStyle(doc, id, { stroke });
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
          tool={tool}
          onTextCreate={handleCreateText}
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
                onEndEdit={obj.type === 'text' ? handleTextEditEnd : selection.endEdit}
                onBoundary={boundary}
                onUndo={undoApi.undo}
                onRedo={undoApi.redo}
                onObjectMiss={handleObjectMiss}
              />
            );
          })}
          <MarqueeRect rect={marquee.rect} />
        </BoardViewport>
        {tool === 'shape' && canEdit && (
          <ShapeTool
            kind={shapeKind}
            camera={camera}
            doc={doc}
            onCreated={toolCreated}
            onBoundary={boundary}
          />
        )}
        {tool === 'connector' && canEdit && (
          <ConnectorTool
            camera={camera}
            snapshot={objects}
            doc={doc}
            onCreated={toolCreated}
            onBoundary={boundary}
          />
        )}
        {tool === 'pen' && canEdit && (
          <>
            <PenTool
              camera={camera}
              color={penOptions.color}
              thickness={penOptions.thickness}
              doc={doc}
              identityId="local"
              onBoundary={boundary}
            />
            <PenToolbar
              color={penOptions.color}
              thickness={penOptions.thickness}
              onColor={penOptions.setColor}
              onThickness={penOptions.setThickness}
            />
          </>
        )}
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
          onTextSize={handleTextSize}
          onShapeFill={handleShapeFill}
          onShapeStroke={handleShapeStroke}
        />
        <Toolbar
          onCreateSticky={handleCreateSticky}
          disabled={!canEdit}
          canUndo={undoApi.canUndo}
          canRedo={undoApi.canRedo}
          onUndo={undoApi.undo}
          onRedo={undoApi.redo}
          tool={tool}
          onToolChange={setTool}
          shapeKind={shapeKind}
          onShapeKindChange={setShapeKind}
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
