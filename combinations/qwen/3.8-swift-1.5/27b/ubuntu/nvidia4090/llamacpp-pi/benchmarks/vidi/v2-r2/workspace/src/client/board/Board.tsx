import { useRef, useLayoutEffect, useState, useEffect, useCallback } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld, type Camera, type Point } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { useMarquee, MarqueeRect } from './Marquee';
import { useBoardKeys } from './useBoardKeys';
import { SelectionOverlay } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { Toolbar } from './Toolbar';
import { getObjectType } from '../objects/registry';
import { createSticky, deleteObjects, objectSnapshot, snapshot } from '../../shared/board-model';
import { createText } from '../../shared/objects/text';
import { createShape, setShapeStyle } from '../../shared/objects/shape';
import { createConnector } from '../../shared/objects/connector';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit, type ConnectionState } from '../sync/connectBoard';
import { createUndo, type UndoController } from './undo';
import { useUndo } from './useUndo';
import { useTool } from './useTool';
import { useActiveTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import type { StickyColor, FillColor, StrokeColor, ShapeKind } from '../../shared/config';

/** Stable per-client identity for object attribution (story 6 is out of scope). */
const CLIENT_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'local-client';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      doc?: Y.Doc;
      snapshot?(): readonly import('../../shared/board-model').StickySnapshot[];
      objects?(): readonly import('../../shared/board-model').ObjectSnapshot[];
      connectionState?: ConnectionState;
      createSticky?(x: number, y: number, color?: StickyColor): string | false;
      createText?(x: number, y: number): string | null;
      createShape?(x: number, y: number, kind?: ShapeKind): string | null;
      createConnector?(fromId: string, toId: string): string | null;
    };
  }
}

/**
 * The board UI (canvas, toolbar, objects). Rendered by BoardPage once the
 * board's existence has been confirmed (story 5).
 *
 * Story 7: objects are rendered through the type registry; selection is a
 * set of ids with a shared transform gesture (move/resize), marquee,
 * selection overlay/bar and board keyboard shortcuts.
 * Story 10: shapes and connectors with the Shape and Connector tools.
 */
export function Board({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1280, height: 800 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setSize({ width, height });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStepFn, reset, setCamera } =
    useCamera(size);
  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(objects);

  // Story 8: one undo controller per board doc; destroyed on board change/unmount.
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) {
    undoRef.current = createUndo(doc);
  }
  // Destroy and recreate when doc changes (board change).
  useEffect(() => {
    return () => {
      undoRef.current?.destroy();
      undoRef.current = null;
    };
  }, [doc]);
  const undoController = undoRef.current;

  const [isPanning, setIsPanning] = useState(false);

  const handlePointerDown = (p: { x: number; y: number }) => {
    setIsPanning(true);
    beginPan(p);
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    endPan();
  };

  const handlePointerCancel = () => {
    setIsPanning(false);
    endPan();
  };

  // Editing is disabled only while the board cannot be loaded (story 4):
  // changes made to an unloadable board could not be stored. A transient
  // disconnect ('reconnecting') keeps the board editable — unsaved changes
  // are re-sent on reconnect.
  const editable = canEdit(connectionState);

  // Story 8: undo/redo binding.
  const { canUndo, canRedo, undo, redo } = useUndo(undoController, editable);

  // Story 9: tool state (Select / Text). Reverts to Select when not editable.
  const { tool, setTool } = useTool(editable);

  // Story 10: extended tool state with shape/connector support
  const activeTool = useActiveTool({
    canEdit: editable,
    onToolCreated: (id) => {
      selection.click(id);
    },
  });

  // Shared move/resize gesture for the selection.
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => undoController.boundary(),
    onGestureEnd: () => undoController.boundary(),
  });

  // Marquee: Shift + drag on empty space select-adds fully-contained objects.
  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));

  // Escape also cancels an in-flight marquee (selection unchanged).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') marquee.cancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [marquee]);

  // Create a sticky note centred on a viewport point; select and edit it.
  const createStickyAtScreenPoint = useCallback(
    (p: Point) => {
      if (!canEdit(connectionState)) return;
      const world = screenToWorld(camera, p);
      const id = createSticky(doc, world);
      if (id) {
        selection.selectAndEdit(id);
      }
    },
    [camera, doc, selection, connectionState]
  );

  // Toolbar button: create at the centre of the visible board area.
  const createStickyAtCentre = useCallback(() => {
    createStickyAtScreenPoint({ x: size.width / 2, y: size.height / 2 });
  }, [createStickyAtScreenPoint, size]);

  // Story 9: text-tool click on empty space (or on an object) creates a text
  // object with its top-left at the point, switches back to Select, and starts
  // editing it.
  const createTextAtScreenPoint = useCallback(
    (p: Point) => {
      if (!canEdit(connectionState)) return;
      const world = screenToWorld(camera, p);
      const id = createText(doc, world, CLIENT_ID);
      if (id) {
        setTool('select');
        activeTool.setTool('select');
        selection.selectAndEdit(id);
      }
    },
    [camera, doc, selection, connectionState, setTool, activeTool]
  );

  // Keyboard: select-all, clear, nudge, delete, enter-to-edit, undo/redo,
  // and the story-9 tool shortcuts (V/T/N/Escape).
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undoController,
    tool,
    setTool,
    onCreateSticky: createStickyAtCentre,
  });

  const deleteSelection = useCallback(() => {
    if (!canEdit(connectionState) || selection.ids.size === 0) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, connectionState]);

  // Story 10: shape/connector tool creation callbacks
  const handleShapeCreated = useCallback((id: string) => {
    activeTool.toolCreated(id);
  }, [activeTool]);

  const handleConnectorCreated = useCallback((id: string) => {
    activeTool.toolCreated(id);
  }, [activeTool]);

  // Story 10: shape style changes
  const handleShapeFill = useCallback((c: FillColor) => {
    if (selection.ids.size !== 1) return;
    const id = [...selection.ids][0];
    setShapeStyle(doc, id, { fill: c });
    undoController.boundary();
  }, [doc, selection.ids, undoController]);

  const handleShapeStroke = useCallback((c: StrokeColor) => {
    if (selection.ids.size !== 1) return;
    const id = [...selection.ids][0];
    setShapeStyle(doc, id, { stroke: c });
    undoController.boundary();
  }, [doc, selection.ids, undoController]);

  // Expose test hook for e2e / component tests
  useEffect(() => {
    window.__vidi6 = {
      setCamera,
      doc,
      snapshot: () => snapshot(doc),
      objects: () => objectSnapshot(doc),
      connectionState,
      createSticky: (x: number, y: number, color?: StickyColor) => createSticky(doc, { x, y }, color),
      createText: (x: number, y: number) => createText(doc, { x, y }, CLIENT_ID),
      createShape: (x: number, y: number, kind?: ShapeKind) => createShape(doc, { kind: kind ?? 'rect', rect: null, at: { x, y } }, CLIENT_ID),
      createConnector: (fromId: string, toId: string) => {
        const snap = objectSnapshot(doc);
        const fromObj = snap.find((o) => o.id === fromId);
        const toObj = snap.find((o) => o.id === toId);
        if (!fromObj || !toObj) return null;
        const from = { kind: 'attached' as const, objectId: fromId, fallback: { x: fromObj.x + (fromObj.width ?? 160) / 2, y: fromObj.y + (fromObj.height ?? 160) / 2 } };
        const to = { kind: 'attached' as const, objectId: toId, fallback: { x: toObj.x + (toObj.width ?? 160) / 2, y: toObj.y + (toObj.height ?? 160) / 2 } };
        return createConnector(doc, from, to, CLIENT_ID);
      },
    };
    return () => {
      delete window.__vidi6;
    };
  }, [setCamera, doc, connectionState]);

  // Object pointer-down: start a move/resize gesture. In the text tool (story
  // 9) a click on an object instead creates text on top of it at that point.
  const handleObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (tool === 'text') {
        e.stopPropagation();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        createTextAtScreenPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        return;
      }
      gesture.onObjectPointerDown(e, id);
    },
    [tool, gesture, createTextAtScreenPoint]
  );

  // Determine the active tool for rendering
  const isShapeTool = activeTool.tool === 'shape';
  const isConnectorTool = activeTool.tool === 'connector';
  const isTextTool = tool === 'text';

  // Shape toolbar: show when exactly one shape is selected
  const selectedShape = selection.ids.size === 1
    ? objects.find((o) => o.id === [...selection.ids][0] && o.type === 'shape')
    : null;

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={camera}
        isPanning={isPanning}
        onPointerDown={handlePointerDown}
        onPointerMove={panMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={wheel}
        onKeyZoomIn={() => zoomStepFn('in')}
        onKeyZoomOut={() => zoomStepFn('out')}
        onKeyReset={reset}
        onEmptyClick={() => selection.clear()}
        onCreateSticky={createStickyAtScreenPoint}
        textToolActive={isTextTool || isShapeTool || isConnectorTool}
        onCreateText={createTextAtScreenPoint}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        <MarqueeRect rect={marquee.rect} />
        {[...objects]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null;
            const Component = spec.Component;
            return (
              <Component
                key={obj.id}
                obj={obj}
                doc={doc}
                z={obj.z}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={selection.editingId === obj.id}
                editable={editable}
                onPointerDown={handleObjectPointerDown}
                onStartEdit={selection.startEdit}
                onEndEdit={() => selection.endEdit()}
                boundary={() => undoController.boundary()}
                undoController={undoController}
                // Extra props for connector
                {...(obj.type === 'connector' ? { snapshot: objects, onBoundary: () => undoController.boundary() } : {})}
              />
            );
          })}
      </BoardViewport>

      {/* Story 10: Shape tool overlay */}
      {isShapeTool && editable && (
        <ShapeTool
          kind={activeTool.shapeKind}
          camera={camera}
          doc={doc}
          createdBy={CLIENT_ID}
          onCreated={handleShapeCreated}
          onBoundary={() => undoController.boundary()}
        />
      )}

      {/* Story 10: Connector tool overlay */}
      {isConnectorTool && editable && (
        <ConnectorTool
          camera={camera}
          doc={doc}
          snapshot={objects}
          createdBy={CLIENT_ID}
          onCreated={handleConnectorCreated}
          onBoundary={() => undoController.boundary()}
        />
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
        doc={doc}
        onDelete={deleteSelection}
      />

      {/* Story 10: Shape toolbar (when a shape is selected) */}
      {selectedShape && (
        <ShapeToolbar
          fill={(selectedShape as unknown as { fill: FillColor }).fill ?? 'white'}
          stroke={(selectedShape as unknown as { stroke: StrokeColor }).stroke ?? 'dark'}
          onFill={handleShapeFill}
          onStroke={handleShapeStroke}
        />
      )}

      <Toolbar
        onCreateSticky={createStickyAtCentre}
        disabled={!editable}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        tool={tool}
        onToolChange={setTool}
        activeToolId={activeTool.tool}
        onActiveToolChange={(t) => {
          activeTool.setTool(t);
          if (t === 'select' || t === 'text') setTool(t as 'select' | 'text');
        }}
        shapeKind={activeTool.shapeKind}
        onShapeKindChange={activeTool.setShapeKind}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStepFn('in')}
        onZoomOut={() => zoomStepFn('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
