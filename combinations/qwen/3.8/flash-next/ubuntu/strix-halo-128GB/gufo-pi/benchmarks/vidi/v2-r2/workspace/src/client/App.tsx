import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { useBoard } from './canvas/BoardContext';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { type Camera, zoomPercent, canZoomIn, canZoomOut, worldToScreen } from './canvas/camera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useMarquee } from './board/Marquee';
import { useUndo } from './board/useUndo';
import { useTool, type Tool } from './board/useTool';
import { createUndo, type UndoController } from './board/undo';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { NoteLayer } from './objects/NoteLayer';
import { NoteToolbar } from './objects/NoteToolbar';
import { TextLayer } from './objects/TextLayer';
import { TextToolbar } from './objects/TextToolbar';
import { ShapeLayer } from './objects/ShapeLayer';
import { ShapeToolbar } from './objects/ShapeToolbar';
import { ConnectorLayer } from './objects/ConnectorLayer';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  objectBounds,
  objectsInRect,
} from '@shared/board-model';
import type { ObjectSnapshot, StickySnapshot, TextObjectSnapshot } from '@shared/board-model';
import type { ShapeSnap } from '@shared/objects/shape';
import { setShapeStyle } from '@shared/objects/shape';
import { createText, setTextSize } from '@shared/objects/text';
import type { Rect } from '@shared/geometry';
import { type StickyColor, type TextSize, type ShapeKind, type FillColor, type StrokeColor } from '@shared/config';
import type { Point } from './canvas/camera';

/**
 * Editing is disabled only while the board cannot be loaded (load_failed). All
 * other connection states (connecting/connected/reconnecting/confirmed) allow
 * editing so a transient storage hiccup never locks the user out.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

function BoardOverlay(): ReactElement {
  const { camera, hasNavigated, zoomStep, reset } = useBoard();
  return (
    <>
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

export function Board({ boardId }: { boardId: string }): ReactElement {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const editable = canEdit(connectionState);
  const selection = useSelection(notes);

  // Camera ref - updated by BoardViewport on every render
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });

  // Viewport ref for tool overlays
  const viewportElRef = useRef<HTMLElement | null>(null);

  // Undo controller: one per board doc, destroyed on board change/unmount
  const undoController: UndoController | null = useMemo(() => {
    if (!doc) return null;
    return createUndo(doc);
  }, [doc]);

  // Destroy previous controller when board changes or component unmounts
  useEffect(() => {
    return () => {
      if (undoController) undoController.destroy();
    };
  }, [undoController]);

  // Undo state for buttons and shortcuts
  const undoState = useUndo(undoController, editable);

  // Tool state
  const { tool, setTool } = useTool(editable);

  // Shape kind state
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');

  // Transform gesture (group move and resize) with boundary hooks
  const { onObjectPointerDown, onHandlePointerDown } = useTransformGesture({
    doc,
    cameraRef,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: undoController ? () => undoController.boundary() : undefined,
    onGestureEnd: undoController ? () => undoController.boundary() : undefined,
  });

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undoController,
    tool,
    setTool: setTool as (t: string) => void,
    onCreateSticky: () => {
      const worldPoint: Point = {
        x: cameraRef.current.x + (typeof window !== 'undefined' ? window.innerWidth : 1280) / 2 / cameraRef.current.zoom,
        y: cameraRef.current.y + (typeof window !== 'undefined' ? window.innerHeight : 800) / 2 / cameraRef.current.zoom,
      };
      handleCreateSticky(worldPoint);
    },
  });

  // Marquee
  const marquee = useMarquee(cameraRef, (ids) => {
    selection.setMany(ids, true);
  }, (rect: Rect) => objectsInRect(notes, rect));

  const handleCreateSticky = useCallback(
    (worldPoint: Point) => {
      if (!editable) return;
      if (undoController) undoController.boundary();
      const id = createSticky(doc, worldPoint);
      if (undoController) undoController.boundary();
      if (id) {
        selection.startEdit(id);
      }
    },
    [doc, selection, editable, undoController],
  );

  const handleEmptyDoubleClick = useCallback(
    (worldPoint: Point) => {
      handleCreateSticky(worldPoint);
    },
    [handleCreateSticky],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  const handleColorChange = useCallback(
    (color: StickyColor) => {
      if (!editable) return;
      if (selection.ids.size === 1) {
        const id = [...selection.ids][0];
        if (undoController) undoController.boundary();
        setStickyColor(doc, id, color);
        if (undoController) undoController.boundary();
      }
    },
    [doc, selection, editable, undoController],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    if (selection.ids.size > 0) {
      if (undoController) undoController.boundary();
      deleteObjects(doc, [...selection.ids]);
      if (undoController) undoController.boundary();
      selection.clear();
    }
  }, [doc, selection, editable, undoController]);

  // Determine which object to show NoteToolbar for (single sticky, not editing)
  const singleSticky: StickySnapshot | null =
    selection.ids.size === 1 && !selection.editingId
      ? (notes.find((n) => n.id === [...selection.ids][0] && n.type === 'sticky') as StickySnapshot ?? null)
      : null;

  // Determine which text object to show TextToolbar for (single text, not editing)
  const singleText: TextObjectSnapshot | null =
    selection.ids.size === 1 && !selection.editingId
      ? (notes.find((n) => n.id === [...selection.ids][0] && n.type === 'text') as TextObjectSnapshot ?? null)
      : null;

  // Determine which shape to show ShapeToolbar for (single shape, not editing)
  const singleShape: ShapeSnap | null =
    selection.ids.size === 1 && !selection.editingId
      ? (notes.find((n) => n.id === [...selection.ids][0] && n.type === 'shape') as ShapeSnap ?? null)
      : null;

  const handleToolClick = useCallback(
    (worldPoint: Point) => {
      if (!editable) return;
      if (tool === 'text') {
        // Create text at world point
        if (undoController) undoController.boundary();
        const id = createText(doc, worldPoint, 'local');
        if (undoController) undoController.boundary();
        if (id) {
          setTool('select');
          selection.startEdit(id);
        }
      }
    },
    [doc, selection, editable, undoController, tool, setTool],
  );

  const handleTextSizeChange = useCallback(
    (size: TextSize) => {
      if (!editable) return;
      if (selection.ids.size === 1) {
        const id = [...selection.ids][0];
        if (undoController) undoController.boundary();
        setTextSize(doc, id, size);
        if (undoController) undoController.boundary();
      }
    },
    [doc, selection, editable, undoController],
  );

  const handleShapeFillChange = useCallback(
    (c: FillColor) => {
      if (!editable) return;
      if (selection.ids.size === 1) {
        const id = [...selection.ids][0];
        if (undoController) undoController.boundary();
        setShapeStyle(doc, id, { fill: c });
        if (undoController) undoController.boundary();
      }
    },
    [doc, selection, editable, undoController],
  );

  const handleShapeStrokeChange = useCallback(
    (c: StrokeColor) => {
      if (!editable) return;
      if (selection.ids.size === 1) {
        const id = [...selection.ids][0];
        if (undoController) undoController.boundary();
        setShapeStyle(doc, id, { stroke: c });
        if (undoController) undoController.boundary();
      }
    },
    [doc, selection, editable, undoController],
  );

  const handleShapeCreated = useCallback(
    (id: string) => {
      selection.click(id);
      setTool('select');
    },
    [selection, setTool],
  );

  const handleConnectorCreated = useCallback(
    (id: string) => {
      selection.click(id);
      setTool('select');
    },
    [selection, setTool],
  );

  // Connector handle re-attach support
  const handleConnectorHandlePointerDown = useCallback(
    (_e: PointerEvent, connId: string, _end: 'from' | 'to') => {
      // For now, just select the connector
      selection.click(connId);
    },
    [selection],
  );

  // Get the viewport element from BoardViewport for tool overlays
  const viewportEl = viewportElRef.current;

  return (
    <div className="vidi6-app">
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        cameraRef={cameraRef}
        onEmptyDoubleClick={tool === 'select' ? handleEmptyDoubleClick : undefined}
        onEmptyClick={tool === 'select' ? handleEmptyClick : undefined}
        onMarqueeBegin={tool === 'select' ? (screen) => marquee.begin(screen) : undefined}
        onMarqueeMove={tool === 'select' ? (screen) => marquee.move(screen) : undefined}
        onMarqueeEnd={tool === 'select' ? () => marquee.end() : undefined}
        onMarqueeCancel={tool === 'select' ? () => marquee.cancel() : undefined}
        tool={tool === 'text' ? 'text' : 'select'}
        onToolClick={handleToolClick}
        viewportRef={viewportElRef}
        overlay={
          <AppChrome
            doc={doc}
            notes={notes}
            selection={selection}
            singleSticky={singleSticky}
            singleText={singleText}
            singleShape={singleShape}
            editable={editable}
            tool={tool}
            shapeKind={shapeKind}
            onToolChange={setTool}
            onShapeKindChange={setShapeKind}
            onColorChange={handleColorChange}
            onDelete={handleDelete}
            onCreateSticky={handleCreateSticky}
            onTextSizeChange={handleTextSizeChange}
            onShapeFillChange={handleShapeFillChange}
            onShapeStrokeChange={handleShapeStrokeChange}
            onHandlePointerDown={onHandlePointerDown}
            undoState={undoState}
          />
        }
      >
        <NoteLayer
          notes={notes}
          doc={doc}
          selection={selection}
          editable={editable}
          onObjectPointerDown={onObjectPointerDown}
          onStartEdit={selection.startEdit}
          onEndEdit={() => selection.endEdit()}
          undoController={undoController}
        />
        <TextLayer
          notes={notes}
          doc={doc}
          selection={selection}
          editable={editable}
          onObjectPointerDown={onObjectPointerDown}
          onStartEdit={selection.startEdit}
          onEndEdit={() => selection.endEdit()}
          undoController={undoController}
        />
        <ShapeLayer
          notes={notes}
          doc={doc}
          selection={selection}
          editable={editable}
          onObjectPointerDown={onObjectPointerDown}
          onStartEdit={selection.startEdit}
          onEndEdit={() => selection.endEdit()}
          undoController={undoController}
        />
        <ConnectorLayer
          notes={notes}
          doc={doc}
          selection={selection}
          onConnectorHandlePointerDown={handleConnectorHandlePointerDown}
        />
        {tool === 'shape' && (
          <ShapeTool
            kind={shapeKind}
            camera={cameraRef.current}
            doc={doc}
            viewportEl={viewportEl}
            onCreated={handleShapeCreated}
            onGestureBoundary={undoController ? () => undoController.boundary() : undefined}
          />
        )}
        {tool === 'connector' && (
          <ConnectorTool
            camera={cameraRef.current}
            doc={doc}
            snapshot={notes}
            viewportEl={viewportEl}
            onCreated={handleConnectorCreated}
            onGestureBoundary={undoController ? () => undoController.boundary() : undefined}
          />
        )}
      </BoardViewport>
    </div>
  );
}

interface AppChromeProps {
  doc: import('yjs').Doc;
  notes: readonly ObjectSnapshot[];
  selection: import('./board/useSelection').SelectionApi;
  singleSticky: StickySnapshot | null;
  singleText: TextObjectSnapshot | null;
  singleShape: ShapeSnap | null;
  editable: boolean;
  tool: Tool;
  shapeKind: ShapeKind;
  onToolChange?(t: Tool): void;
  onShapeKindChange?(k: ShapeKind): void;
  onColorChange(c: StickyColor): void;
  onDelete(): void;
  onCreateSticky(p: Point): void;
  onTextSizeChange(s: TextSize): void;
  onShapeFillChange(c: FillColor): void;
  onShapeStrokeChange(c: StrokeColor): void;
  onHandlePointerDown(e: PointerEvent, h: import('@shared/geometry').Handle): void;
  undoState: ReturnType<typeof useUndo>;
}

function AppChrome(props: AppChromeProps): ReactElement {
  const { camera, viewport } = useBoard();
  const { selection } = props;

  const handleCreateFromToolbar = useCallback(() => {
    const worldPoint: Point = {
      x: camera.x + viewport.width / 2 / camera.zoom,
      y: camera.y + viewport.height / 2 / camera.zoom,
    };
    props.onCreateSticky(worldPoint);
  }, [camera, viewport, props]);

  return (
    <>
      <BoardOverlay />
      <Toolbar
        onCreateSticky={handleCreateFromToolbar}
        disabled={!props.editable}
        undo={props.undoState}
        tool={props.tool}
        onToolChange={props.onToolChange}
        shapeKind={props.shapeKind}
        onShapeKindChange={props.onShapeKindChange}
        onShapeToolClick={() => props.onToolChange?.('shape')}
        onConnectorToolClick={() => props.onToolChange?.('connector')}
      />

      {/* Selection overlay (bounding box + handles) */}
      {selection.ids.size > 0 && (
        <SelectionOverlay
          ids={selection.ids}
          snapshot={props.notes}
          camera={camera}
          onHandlePointerDown={props.onHandlePointerDown}
        />
      )}

      {/* Selection bar for 2+ selected */}
      {selection.ids.size >= 2 && (
        <SelectionBar
          ids={selection.ids}
          snapshot={props.notes}
          camera={camera}
          onDelete={props.onDelete}
        />
      )}

      {/* NoteToolbar for single sticky */}
      {props.singleSticky && !props.selection.editingId && (
        <NoteToolbarScreenSpace
          note={props.singleSticky}
          camera={camera}
          onColor={props.onColorChange}
          onDelete={props.onDelete}
        />
      )}

      {/* TextToolbar for single text */}
      {props.singleText && !props.selection.editingId && (
        <TextToolbarScreenSpace
          textObj={props.singleText}
          camera={camera}
          onSize={props.onTextSizeChange}
          onDelete={props.onDelete}
        />
      )}

      {/* ShapeToolbar for single shape */}
      {props.singleShape && !props.selection.editingId && (
        <ShapeToolbarScreenSpace
          shape={props.singleShape}
          camera={camera}
          onFill={props.onShapeFillChange}
          onStroke={props.onShapeStrokeChange}
          onDelete={props.onDelete}
        />
      )}
    </>
  );
}

function NoteToolbarScreenSpace({
  note,
  camera,
  onColor,
  onDelete,
}: {
  note: StickySnapshot;
  camera: { x: number; y: number; zoom: number };
  onColor(c: StickyColor): void;
  onDelete(): void;
}): ReactElement {
  const bounds = objectBounds(note);
  const screenPos = worldToScreen(camera, {
    x: bounds.x + bounds.width / 2,
    y: bounds.y,
  });

  return (
    <div
      style={{
        position: 'fixed',
        left: screenPos.x,
        top: screenPos.y - 40,
        transform: 'translateX(-50%)',
        zIndex: 20,
      }}
    >
      <NoteToolbar color={note.color} onColor={onColor} onDelete={onDelete} />
    </div>
  );
}

/**
 * Top-level router (story 5): `/` -> Home, `/b/:id` -> Board page, anything else
 * -> Board not found.
 */
export function App(): ReactElement {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage id={route.id} />;
  return <NotFoundPage />;
}

function TextToolbarScreenSpace({
  textObj,
  camera,
  onSize,
  onDelete,
}: {
  textObj: TextObjectSnapshot;
  camera: { x: number; y: number; zoom: number };
  onSize(s: TextSize): void;
  onDelete(): void;
}): ReactElement {
  const bounds = objectBounds(textObj);
  const screenPos = worldToScreen(camera, {
    x: bounds.x + bounds.width / 2,
    y: bounds.y,
  });

  return (
    <div
      style={{
        position: 'fixed',
        left: screenPos.x,
        top: screenPos.y - 40,
        transform: 'translateX(-50%)',
        zIndex: 20,
      }}
    >
      <TextToolbar size={textObj.size as TextSize} onSize={onSize} onDelete={onDelete} />
    </div>
  );
}

function ShapeToolbarScreenSpace({
  shape,
  camera,
  onFill,
  onStroke,
  onDelete: _onDelete,
}: {
  shape: ShapeSnap;
  camera: { x: number; y: number; zoom: number };
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
  onDelete(): void;
}): ReactElement {
  const bounds = objectBounds(shape);
  const screenPos = worldToScreen(camera, {
    x: bounds.x + bounds.width / 2,
    y: bounds.y,
  });

  return (
    <div
      style={{
        position: 'fixed',
        left: screenPos.x,
        top: screenPos.y - 40,
        transform: 'translateX(-50%)',
        zIndex: 20,
      }}
    >
      <ShapeToolbar fill={shape.fill} stroke={shape.stroke} onFill={onFill} onStroke={onStroke} />
    </div>
  );
}
