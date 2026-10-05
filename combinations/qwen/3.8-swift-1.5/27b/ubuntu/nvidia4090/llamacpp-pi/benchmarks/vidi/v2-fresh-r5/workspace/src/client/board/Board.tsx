/**
 * The live board for one board id (stories 1–7): document, multi-selection,
 * toolbar, objects, connection badge, marquee, transform gesture, and
 * keyboard shortcuts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { Toolbar } from './Toolbar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import { reportConnectionState } from '../canvas/testHooks';
import { createSticky, setStickyColor, deleteObjects } from '../../shared/board-model';
import { createText, setTextSize } from '../../shared/objects/text';
import { setShapeStyle } from '../../shared/objects/shape';
import { STICKY_SIZE_WORLD, type StickyColor, type TextSize, type FillColor, type StrokeColor } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import { useMarquee, MarqueeRect } from './Marquee';
import { useTransformGesture } from './useTransformGesture';
import { SelectionOverlay } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { useBoardKeys } from './useBoardKeys';
import { useTool } from './useTool';
import { useActiveTool, type ToolId } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { createUndo, type UndoController } from './undo';
import { useUndo } from './useUndo';
import type { Handle } from '../../shared/geometry';
import type { Rect } from '../../shared/geometry';

/**
 * The live board for one board id: document, selection state, toolbar,
 * objects, connection badge, and keyboard shortcuts.
 */
export function Board({ boardId }: { boardId: string }): JSX.Element {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  // Editing is locked only while the board failed to load (close code 4500).
  const editable = canEdit(connectionState);

  // Publish the mapped state for long-running e2e tests (test builds only).
  useEffect(() => {
    reportConnectionState(connectionState);
  }, [connectionState]);

  // Camera ref updated by BoardViewport via onCameraChange callback
  const cameraRef = useRef<Camera>({ x: -640, y: -400, zoom: 1 });
  const [camera, setCamera] = useState<Camera>({ x: -640, y: -400, zoom: 1 });

  // Per-user undo controller (story 8): session-only, scoped to this doc.
  const [undo, setUndo] = useState<UndoController | null>(null);
  useEffect(() => {
    const controller = createUndo(doc);
    setUndo(controller);
    return () => {
      controller.destroy();
      setUndo(null);
    };
  }, [doc]);
  const undoBinding = useUndo(undo, editable);
  const undoBoundary = useCallback(() => {
    undo?.boundary();
  }, [undo]);

  // Marquee
  const marquee = useMarquee(camera, notes, (ids) => {
    selection.setMany(ids, true);
  });

  // Stable, non-React-managed pointer-capture target for object gestures.
  // Created once and appended to <body> (outside the React tree) so it is
  // never re-rendered. Browsers mis-route pointer events when the capture
  // target is a React element whose attributes change during the drag, or a
  // different element per gesture; a single persistent element is immune.
  const gestureCaptureEl = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.setAttribute('data-gesture-capture', '');
    el.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    document.body.appendChild(el);
    gestureCaptureEl.current = el;
    return () => {
      el.remove();
      gestureCaptureEl.current = null;
    };
  }, []);

  // Transform gesture
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    boundary: undoBoundary,
    captureElRef: gestureCaptureEl,
  });

  // Tool state (story 9)
  const { tool, setTool } = useTool(editable);

  // Pen options (story 11): session-only colour/thickness
  const penOptions = usePenOptions();

  // Active tool hook (story 10) - extends tool with shape/connector
  const { tool: activeTool, shapeKind, setShapeKind, toolCreated, setTool: setActiveTool } = useActiveTool({
    canEdit: editable,
    onSelect: (id: string) => {
      selection.setMany([id], false);
    },
  });

  // Unified tool state: use activeTool from useActiveTool
  const currentTool: ToolId = activeTool;

  const onDblClickEmpty = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (!editable) return;
      const cam = cameraRef.current;
      const world = screenToWorld(cam, screenPoint);
      const id = createSticky(doc, world);
      if (id) {
        selection.startEdit(id);
      }
    },
    [doc, selection, editable],
  );

  // Text tool: click on board to create text (story 9)
  const onTextToolClick = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (!editable) return;
      const cam = cameraRef.current;
      const world = screenToWorld(cam, screenPoint);
      const id = createText(doc, world, 'local');
      if (id) {
        setTool('select');
        selection.setMany([id], false);
        selection.startEdit(id);
      }
    },
    [doc, selection, editable, setTool],
  );

  const onClickEmpty = useCallback(
    (screenPoint?: { x: number; y: number }) => {
      if (tool === 'text' && screenPoint) {
        onTextToolClick(screenPoint);
      } else if (currentTool === 'select') {
        selection.clear();
      }
    },
    [tool, currentTool, onTextToolClick, selection],
  );

  const onCreateSticky = useCallback(() => {
    if (!editable) return;
    const cam = cameraRef.current;
    const centre = { x: 640, y: 400 };
    const world = screenToWorld(cam, centre);
    undoBoundary();
    const id = createSticky(doc, world);
    undoBoundary();
    if (id) {
      selection.startEdit(id);
    }
  }, [doc, selection, editable, undoBoundary]);

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    boundary: undoBoundary,
    undo,
    tool,
    setTool,
    onCreateSticky,
  });

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: Handle) => {
      gesture.onHandlePointerDown(e, handle);
    },
    [gesture],
  );

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      gesture.onObjectPointerDown(e, id);
    },
    [gesture],
  );

  const onObjectDoubleClick = useCallback(
    (id: string) => {
      if (!editable) return;
      const obj = notes.find((o) => o.id === id);
      if (obj && (obj.type === 'sticky' || obj.type === 'text' || obj.type === 'shape')) {
        selection.startEdit(id);
      }
    },
    [editable, notes, selection],
  );

  const onDeleteSelection = useCallback(() => {
    if (!editable) return;
    undoBoundary();
    deleteObjects(doc, Array.from(selection.ids));
    undoBoundary();
    selection.clear();
  }, [doc, selection, editable, undoBoundary]);

  const onColorChange = useCallback(
    (color: StickyColor) => {
      if (!editable) return;
      if (selection.ids.size !== 1) return;
      const [id] = selection.ids;
      undoBoundary();
      setStickyColor(doc, id, color);
      undoBoundary();
    },
    [doc, selection, editable, undoBoundary],
  );

  const onShapeFillChange = useCallback(
    (fill: FillColor) => {
      if (!editable) return;
      if (selection.ids.size !== 1) return;
      const [id] = selection.ids;
      undoBoundary();
      setShapeStyle(doc, id, { fill });
      undoBoundary();
    },
    [doc, selection, editable, undoBoundary],
  );

  const onShapeStrokeChange = useCallback(
    (stroke: StrokeColor) => {
      if (!editable) return;
      if (selection.ids.size !== 1) return;
      const [id] = selection.ids;
      undoBoundary();
      setShapeStyle(doc, id, { stroke });
      undoBoundary();
    },
    [doc, selection, editable, undoBoundary],
  );

  const onTextSizeChange = useCallback(
    (size: TextSize) => {
      if (!editable) return;
      if (selection.ids.size !== 1) return;
      const [id] = selection.ids;
      undoBoundary();
      setTextSize(doc, id, size);
      undoBoundary();
    },
    [doc, selection, editable, undoBoundary],
  );

  // Build a rects map for connector rendering
  const rectsMap = new Map<string, Rect>();
  for (const obj of notes) {
    if (obj.type === 'connector') continue;
    const w = obj.width ?? STICKY_SIZE_WORLD;
    const h = obj.height ?? STICKY_SIZE_WORLD;
    rectsMap.set(obj.id, { x: obj.x, y: obj.y, width: w, height: h });
  }

  // Render objects through the registry
  const renderObjects = () => {
    return notes.map((obj) => {
      const spec = getObjectType(obj.type);
      if (!spec) return null;
      const Comp = spec.Component;
      return (
        <Comp
          key={obj.id}
          obj={obj}
          selected={selection.ids.has(obj.id)}
          editing={selection.editingId === obj.id}
          canEdit={editable}
          pointerDisabled={tool === 'text' || currentTool === 'shape' || currentTool === 'connector' || currentTool === 'pen'}
          onPointerDown={onObjectPointerDown}
          onDoubleClick={onObjectDoubleClick}
          doc={doc}
          onEndEdit={(next: 'selected' | 'unselected') => {
            selection.endEdit(next);
          }}
          undo={undo}
          {...(obj.type === 'connector'
            ? { rects: rectsMap, camera }
            : obj.type === 'stroke'
              ? { camera }
              : {})}
        />
      );
    });
  };

  // Check if a single shape is selected (for shape toolbar)
  const selectedShape = (() => {
    if (selection.ids.size !== 1) return null;
    const [id] = selection.ids;
    const obj = notes.find((o) => o.id === id);
    if (obj && obj.type === 'shape') return obj;
    return null;
  })();

  // Position the selection bar above the bounding box
  const barPosition = (() => {
    if (selection.ids.size === 0) return null;
    const selectedRects = notes
      .filter((o) => selection.ids.has(o.id))
      .map((o) => {
        const w = o.width ?? STICKY_SIZE_WORLD;
        const h = o.height ?? STICKY_SIZE_WORLD;
        return { x: o.x, y: o.y, w, h };
      });
    if (selectedRects.length === 0) return null;
    const minY = Math.min(...selectedRects.map((r) => r.y));
    const centerX = selectedRects.reduce((s, r) => s + r.x + r.w / 2, 0) / selectedRects.length;
    const screen = worldToScreen(camera, { x: centerX, y: minY });
    return { left: screen.x, top: screen.y - 8 };
  })();

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        onDblClickEmpty={onDblClickEmpty}
        onClickEmpty={onClickEmpty}
        onCameraChange={(cam) => {
          cameraRef.current = cam;
          setCamera(cam);
        }}
        onMarqueeBegin={(screen) => marquee.begin(screen)}
        onMarqueeMove={(screen) => marquee.move(screen)}
        onMarqueeEnd={() => marquee.end()}
        onMarqueeCancel={() => marquee.cancel()}
        cursor={tool === 'text' ? 'text' : undefined}
        penActive={currentTool === 'pen'}
      >
        {renderObjects()}
        <MarqueeRect rect={marquee.rect} />
      </BoardViewport>

      {/* Shape tool overlay */}
      {currentTool === 'shape' && editable && (
        <ShapeTool
          kind={shapeKind}
          camera={camera}
          doc={doc}
          onCreated={(id) => {
            undoBoundary();
            toolCreated(id);
            undoBoundary();
          }}
        />
      )}

      {/* Connector tool overlay */}
      {currentTool === 'connector' && editable && (
        <ConnectorTool
          camera={camera}
          snapshot={notes}
          doc={doc}
          onCreated={(id) => {
            undoBoundary();
            toolCreated(id);
            undoBoundary();
          }}
        />
      )}

      {/* Pen tool overlay (story 11) */}
      {currentTool === 'pen' && editable && (
        <PenTool
          camera={camera}
          color={penOptions.color}
          thickness={penOptions.thickness}
          doc={doc}
          identityId="local"
          onCommit={undoBoundary}
        />
      )}

      {/* Pen toolbar (story 11): next to the left toolbar while Pen is active */}
      {currentTool === 'pen' && editable && (
        <div
          style={{
            position: 'fixed',
            left: '80px',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 100,
          }}
        >
          <PenToolbar
            color={penOptions.color}
            thickness={penOptions.thickness}
            onColor={penOptions.setColor}
            onThickness={penOptions.setThickness}
          />
        </div>
      )}

      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={onHandlePointerDown}
      />

      {barPosition && (
        <div
          style={{
            position: 'fixed',
            left: `${barPosition.left}px`,
            top: `${barPosition.top}px`,
            transform: 'translate(-50%, -100%)',
            zIndex: 1000,
          }}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            onDelete={onDeleteSelection}
            onColor={onColorChange}
            onTextSize={onTextSizeChange}
          />
        </div>
      )}

      {/* Shape toolbar (shown when a single shape is selected) */}
      {selectedShape && currentTool === 'select' && (
        <div
          style={{
            position: 'fixed',
            left: `${barPosition?.left ?? 0}px`,
            top: `${(barPosition?.top ?? 0) - 40}px`,
            transform: 'translate(-50%, -100%)',
            zIndex: 1000,
          }}
        >
          <ShapeToolbar
            fill={(selectedShape.fill ?? 'white') as FillColor}
            stroke={(selectedShape.stroke ?? 'dark') as StrokeColor}
            onFill={onShapeFillChange}
            onStroke={onShapeStrokeChange}
          />
        </div>
      )}

      <Toolbar
        onCreateSticky={onCreateSticky}
        disabled={!editable}
        undo={undoBinding}
        tool={currentTool}
        onToolChange={(t) => {
          setActiveTool(t);
          setTool(t as any);
        }}
        shapeKind={shapeKind}
        onShapeKindChange={setShapeKind}
      />
    </>
  );
}
