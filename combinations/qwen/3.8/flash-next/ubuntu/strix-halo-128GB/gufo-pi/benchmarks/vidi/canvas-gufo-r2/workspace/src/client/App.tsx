import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { JSX } from 'react';
import type * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Camera } from './canvas/camera';
import { BoardViewport, useBoardCamera } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection, type SelectionApi } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { NoteToolbar } from './objects/NoteToolbar';
import { TextToolbar } from './objects/TextToolbar';
import { ShapeToolbar } from './objects/ShapeToolbar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useActiveTool, type ToolId } from './tools/useActiveTool';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { createUndo, type UndoController } from './board/undo';
import { useUndo } from './board/useUndo';
import { getObjectType } from './objects/registry';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  type ObjectSnapshot,
} from '../shared/board-model';
import { createText, setTextSize } from '../shared/objects/text';
import { setShapeStyle } from '../shared/objects/shape';
import type { TextSize, FillColor, StrokeColor, ShapeKind } from '../shared/config';
import { type StickyColor } from '../shared/config';
import type { Point } from './canvas/camera';
import type { Rect } from '../shared/geometry';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SharePanel } from './share/SharePanel';

/** Imperative bridge so callbacks defined outside the viewport can read the
 * current camera and convert points using the live viewport size. */
interface BoardBridge {
  toWorld(screenPoint: Point): Point;
  viewportCentreWorld(): Point;
  getCamera(): Camera;
  getBoardRect(): DOMRect | null;
}

const FALLBACK_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** Screen-space chrome over the board: toolbars, zoom control, hint. */
function BoardChrome(props: {
  connectionState: ReturnType<typeof useBoardDoc>['connectionState'];
  tool: ToolId;
  onToolChange(t: ToolId): void;
  onCreateSticky(): void;
  shapeKind: ShapeKind;
  onShapeKindChange(k: ShapeKind): void;
  undoState: ReturnType<typeof useUndo>;
}): JSX.Element {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();
  const { connectionState, tool, onToolChange, onCreateSticky, shapeKind, onShapeKindChange, undoState } = props;
  const editable = canEdit(connectionState);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <Toolbar
        tool={tool}
        onToolChange={onToolChange}
        onCreateSticky={onCreateSticky}
        shapeKind={shapeKind}
        onShapeKindChange={onShapeKindChange}
        disabled={!editable}
        undoState={undoState}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

/** Installs the camera bridge; rendered inside BoardViewport so camera context is available. */
function CameraBridge(props: { register(bridge: BoardBridge | null): void }): null {
  const { camera } = useBoardCamera();
  const registerRef = useRef(props.register);
  registerRef.current = props.register;

  useEffect(() => {
    const el = document.querySelector('[data-testid="board"]') as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const vw = rect?.width || window.innerWidth || 1024;
    const vh = rect?.height || window.innerHeight || 768;
    registerRef.current({
      toWorld: (p) => screenToWorld(camera, p),
      viewportCentreWorld: () => screenToWorld(camera, { x: vw / 2, y: vh / 2 }),
      getCamera: () => camera,
      getBoardRect: () => el?.getBoundingClientRect() ?? null,
    });
    return () => registerRef.current(null);
  }, [registerRef, camera]);

  return null;
}

/** World-layer board objects, resolved through the object-type registry. */
function BoardObjects(props: {
  objects: readonly ObjectSnapshot[];
  doc: Y.Doc;
  selection: SelectionApi;
  readOnly: boolean;
  onObjectPointerDown: ReturnType<typeof useTransformGesture>['onObjectPointerDown'];
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  undo?: UndoController;
  getCamera: () => Camera;
}): JSX.Element {
  const { camera } = useBoardCamera();
  const { objects, doc, selection, readOnly } = props;

  // Build rects map for connector endpoints
  const rects = useMemo(() => {
    const map = new Map<string, Rect>();
    for (const o of objects) {
      if (o.type !== 'connector') {
        const w = o.width ?? 200;
        const h = o.height ?? 200;
        map.set(o.id, { x: o.x, y: o.y, width: w, height: h });
      }
    }
    return map;
  }, [objects]);

  return (
    <>
      {[...objects]
        .slice()
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null;
          const Component = spec.Component;
          const extra: Record<string, unknown> = {};
          if (obj.type === 'connector') {
            extra.rects = rects;
            extra.snapshot = objects;
            extra.getCamera = props.getCamera;
          }
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              readOnly={readOnly}
              onObjectPointerDown={props.onObjectPointerDown}
              onStartEdit={props.onStartEdit}
              onEndEdit={props.onEndEdit}
              undo={props.undo}
              {...extra}
            />
          );
        })}
    </>
  );
}

/**
 * Board editing is refused while the server cannot load the board.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * The board UI (stories 1–10). Mounted by BoardPage when the board exists.
 */
export function App(props: { doc?: Y.Doc; boardId?: string } = {}) {
  const boardId = props.boardId ?? getBoardIdFromPath();
  const { doc, notes, connectionState } = useBoardDoc(props.doc, boardId);
  const canEditBoard = canEdit(connectionState);

  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undoController.destroy(), [undoController]);

  const undoState = useUndo(undoController, canEditBoard);

  const selection = useSelection(notes);

  const handleSelectForTool = useCallback((id: string) => {
    selection.click(id);
  }, [selection]);

  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({
    canEdit: canEditBoard,
    onSelect: handleSelectForTool,
  });

  const bridgeRef = useRef<BoardBridge | null>(null);
  const registerBridge = useCallback((b: BoardBridge | null) => {
    bridgeRef.current = b;
  }, []);
  const getCamera = useCallback(() => bridgeRef.current?.getCamera() ?? FALLBACK_CAMERA, []);
  const getBoardRect = useCallback(() => bridgeRef.current?.getBoardRect() ?? null, []);

  const gesture = useTransformGesture({
    doc,
    getCamera,
    selection,
    snapshot: notes,
    canEdit: canEditBoard,
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
  });

  const handleCreateSticky = useCallback(() => {
    if (!canEditBoard) return;
    const b = bridgeRef.current;
    const world = b ? b.viewportCentreWorld() : { x: 0, y: 0 };
    undoController.boundary();
    const id = createSticky(doc, world);
    undoController.boundary();
    selection.click(id);
    selection.startEdit(id);
  }, [canEditBoard, doc, selection, undoController]);

  useBoardKeys({ doc, selection, snapshot: notes, canEdit: canEditBoard, undo: undoController, tool, setTool, onCreateSticky: handleCreateSticky });

  const handleStartEdit = useCallback(
    (id: string) => {
      if (!canEditBoard) return;
      const obj = notes.find((o) => o.id === id);
      if (!obj || !getObjectType(obj.type)?.editableText) return;
      selection.startEdit(id);
    },
    [canEditBoard, notes, selection],
  );

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => selection.endEdit(next),
    [selection],
  );

  const handleDeleteSelection = useCallback(() => {
    if (!canEditBoard || selection.ids.size === 0) return;
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController.boundary();
    selection.clear();
  }, [canEditBoard, doc, selection, undoController]);

  const handleBoardDblClick = useCallback(
    (point: Point) => {
      if (!canEditBoard) return;
      const b = bridgeRef.current;
      const world = b ? b.toWorld(point) : point;
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      selection.click(id);
      selection.startEdit(id);
    },
    [canEditBoard, doc, selection, undoController],
  );

  const handleEmptyClick = useCallback(() => selection.clear(), [selection]);

  // Text tool click creates text and returns to select
  const handleTextToolClick = useCallback(
    (point: Point) => {
      if (!canEditBoard) return;
      const b = bridgeRef.current;
      const world = b ? b.toWorld(point) : point;
      undoController.boundary();
      const id = createText(doc, world, 'user');
      undoController.boundary();
      if (id) {
        setTool('select');
        selection.click(id);
        selection.startEdit(id);
      }
    },
    [canEditBoard, doc, selection, undoController, setTool],
  );

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!canEditBoard || selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      undoController.boundary();
      setStickyColor(doc, id, color);
      undoController.boundary();
    },
    [canEditBoard, doc, selection, undoController],
  );

  const handleTextSize = useCallback(
    (size: TextSize) => {
      if (!canEditBoard || selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      undoController.boundary();
      setTextSize(doc, id, size);
      undoController.boundary();
    },
    [canEditBoard, doc, selection, undoController],
  );

  // Shape style change
  const handleShapeFill = useCallback(
    (c: FillColor) => {
      if (!canEditBoard || selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      undoController.boundary();
      setShapeStyle(doc, id, { fill: c });
      undoController.boundary();
    },
    [canEditBoard, doc, selection, undoController],
  );

  const handleShapeStroke = useCallback(
    (c: StrokeColor) => {
      if (!canEditBoard || selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      undoController.boundary();
      setShapeStyle(doc, id, { stroke: c });
      undoController.boundary();
    },
    [canEditBoard, doc, selection, undoController],
  );

  // Tool-created callbacks
  const handleShapeCreated = useCallback((id: string) => {
    undoController.boundary();
    toolCreated(id);
  }, [undoController, toolCreated]);

  const handleConnectorCreated = useCallback((id: string) => {
    undoController.boundary();
    toolCreated(id);
  }, [undoController, toolCreated]);

  // Pen options (session-only)
  const penOptions = usePenOptions();

  // Selected toolbars
  const selectedSticky: ObjectSnapshot | null =
    canEditBoard && selection.ids.size === 1 && selection.editingId === null
      ? notes.find((n) => n.id === [...selection.ids][0] && n.type === 'sticky') ?? null
      : null;

  const selectedText: ObjectSnapshot | null =
    canEditBoard && selection.ids.size === 1 && selection.editingId === null
      ? notes.find((n) => n.id === [...selection.ids][0] && n.type === 'text') ?? null
      : null;

  const selectedShape: ObjectSnapshot | null =
    canEditBoard && selection.ids.size === 1 && selection.editingId === null
      ? notes.find((n) => n.id === [...selection.ids][0] && n.type === 'shape') ?? null
      : null;

  // Determine BoardViewport tool prop
  const viewportTool = tool === 'text' ? 'text' : 'select';

  return (
    <div className="board-container">
      {boardId && <SharePanel boardId={boardId} />}
      <BoardViewport
        snapshot={notes}
        onMarqueeSelect={(ids, additive) => selection.setMany(ids, additive)}
        tool={viewportTool}
        onTextToolClick={handleTextToolClick}
        children={
          <>
            <CameraBridge register={registerBridge} />
            <BoardObjects
              objects={notes}
              doc={doc}
              selection={selection}
              readOnly={!canEditBoard}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={handleStartEdit}
              onEndEdit={handleEndEdit}
              undo={undoController}
              getCamera={getCamera}
            />
          </>
        }
        overlay={
          <>
            <SelectionOverlay
              ids={selection.ids}
              snapshot={notes}
              onHandlePointerDown={gesture.onHandlePointerDown}
            />
            <SelectionBar
              count={selection.ids.size}
              ids={selection.ids}
              snapshot={notes}
              onDelete={handleDeleteSelection}
            />
            {selectedSticky && selectedSticky.color && (
              <NoteToolbar
                color={selectedSticky.color as StickyColor}
                onColor={handleColor}
                onDelete={handleDeleteSelection}
              />
            )}
            {selectedText && (
              <TextToolbar
                size={(selectedText.size as TextSize) ?? 'M'}
                onSize={handleTextSize}
                onDelete={handleDeleteSelection}
              />
            )}
            {selectedShape && (
              <ShapeToolbar
                fill={(selectedShape.fill as FillColor) ?? 'white'}
                stroke={(selectedShape.stroke as StrokeColor) ?? 'dark'}
                onFill={handleShapeFill}
                onStroke={handleShapeStroke}
              />
            )}
            <BoardChrome
              connectionState={connectionState}
              tool={tool}
              onToolChange={setTool}
              onCreateSticky={handleCreateSticky}
              shapeKind={shapeKind}
              onShapeKindChange={setShapeKind}
              undoState={undoState}
            />
            {tool === 'shape' && (
              <ShapeTool
                kind={shapeKind}
                camera={getCamera()}
                doc={doc}
                canEdit={canEditBoard}
                onCreated={handleShapeCreated}
                getBoardRect={getBoardRect}
              />
            )}
            {tool === 'connector' && (
              <ConnectorTool
                camera={getCamera()}
                doc={doc}
                snapshot={notes}
                canEdit={canEditBoard}
                onCreated={handleConnectorCreated}
                getBoardRect={getBoardRect}
              />
            )}
            {tool === 'pen' && (
              <PenTool
                camera={getCamera()}
                color={penOptions.color}
                thickness={penOptions.thickness}
                doc={doc}
                identityId="user"
                canEdit={canEditBoard}
                undo={undoController}
                getBoardRect={getBoardRect}
              />
            )}
            {tool === 'pen' && (
              <PenToolbar
                color={penOptions.color}
                thickness={penOptions.thickness}
                onColor={penOptions.setColor}
                onThickness={penOptions.setThickness}
              />
            )}
          </>
        }
        onBoardDblClick={handleBoardDblClick}
        onBoardEmptyClick={handleEmptyClick}
      />
    </div>
  );
}

/** Extract board ID from /b/:boardId path. */
function getBoardIdFromPath(): string | undefined {
  const match = window.location.pathname.match(/^\/b\/([A-Za-z0-9_-]+)/);
  return match?.[1];
}

/**
 * Top-level router: renders home, board, or not-found based on route.
 */
export function RouterApp() {
  const route = useRoute();

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
