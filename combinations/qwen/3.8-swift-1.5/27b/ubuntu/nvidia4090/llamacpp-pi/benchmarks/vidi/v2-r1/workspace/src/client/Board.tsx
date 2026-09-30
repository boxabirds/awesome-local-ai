import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { screenToWorld } from './canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';
import { setupTestHooks } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { useActiveTool } from './tools/useActiveTool';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { Toolbar } from './board/Toolbar';
import { ShapeToolbar } from './objects/ShapeToolbar';
import { createUndo, type UndoController } from './board/undo';
import { useUndo } from './board/useUndo';
import { getObjectType } from './objects/registry';
import { syncTextBox } from './objects/useTextBoxSync';
import { defaultMeasurer } from './objects/textLayout';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import {
  createSticky, deleteObjects, setStickyColor,
} from '@shared/board-model';
import { setShapeStyle } from '@shared/objects/shape';
import { createText, setTextSize } from '@shared/objects/text';
import type { StickyColor, TextSize, FillColor, StrokeColor } from '@shared/config';
import type { Point, Rect } from '@shared/geometry';

// Story 6 (presence/identity) is out of scope for this build; the text
// model's `createdBy` needs a stable per-tab session id, so we generate one
// here (stable for the life of the tab).
const SESSION_ID = crypto.randomUUID();

/**
 * Story 7 board UI: multi-object selection, group move, bounding-box
 * resize, marquee, keyboard shortcuts and the selection bar.
 */
export function Board(props: { boardId: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  const boardId = props.boardId;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cam = useCamera(size);
  const { doc, objects, connectionState } = useBoardDoc(boardId);

  // Set up test hooks
  useEffect(() => {
    setupTestHooks(cam, doc);
  }, [cam, doc]);

  const editAllowed = canEdit(connectionState);

  // Story 10: active tool with shortcuts and return-to-Select.
  const toolState = useActiveTool({
    onSelect: (id) => selection.click(id),
    canEdit: editAllowed,
  });

  // Story 11: session-only pen options (colour and thickness).
  const penOptions = usePenOptions();

  // Story 8: create one undo controller per board doc.
  const undoCtrlRef = useRef<UndoController | null>(null);
  const undoDocRef = useRef<Y.Doc | null>(null);
  if (doc && undoDocRef.current !== doc) {
    undoCtrlRef.current?.destroy();
    undoCtrlRef.current = createUndo(doc);
    undoDocRef.current = doc;
  }
  const undoController = undoCtrlRef.current;

  // Destroy controller on unmount or board change.
  useEffect(() => {
    return () => {
      undoCtrlRef.current?.destroy();
      undoCtrlRef.current = null;
      undoDocRef.current = null;
    };
  }, [doc]);

  // Story 8: React binding for undo/redo state.
  const undoState = useUndo(undoController!, editAllowed);

  // Multi-object selection (story 7).
  const selection = useSelection(objects);

  // Transform gesture: group move + bounding-box resize.
  const gestureStartedRef = useRef(false);
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection,
    snapshot: objects,
    canEdit: editAllowed,
    onGestureStart: () => {
      gestureStartedRef.current = true;
      undoController?.boundary();
    },
    onGestureEnd: () => {
      gestureStartedRef.current = false;
      undoController?.boundary();
    },
    // Story 9: after a handle resize that touched text objects, re-measure
    // their height from the (possibly new fixed) width. Runs before the
    // end boundary so the box write lands in the same capture window as
    // the drag (PRD text.undo / text.height).
    onTextsResized: (ids) => {
      for (const id of ids) syncTextBox(doc, id, defaultMeasurer);
    },
  });

  // Marquee: Shift+drag over empty space adds fully-contained objects.
  const marquee = useMarquee(cam.camera, objects, useCallback(
    (ids: string[]) => selection.setMany(ids, true),
    [selection],
  ));

  // Create a sticky note at a world point
  const createStickyAt = useCallback((worldPoint: Point) => {
    if (!canEdit(connectionState)) return;
    undoController?.boundary();
    const id = createSticky(doc, worldPoint);
    if (id) {
      selection.startEdit(id);
    }
  }, [doc, selection, connectionState, undoController]);

  // Handle double-click on empty board space
  const handleDoubleClickEmpty = useCallback((screenPoint: Point) => {
    if (!canEdit(connectionState)) return;
    const worldPoint = screenToWorld(cam.camera, screenPoint);
    createStickyAt(worldPoint);
  }, [cam.camera, createStickyAt, connectionState]);

  // Handle click on Sticky note toolbar button
  const handleCreateSticky = useCallback(() => {
    if (!canEdit(connectionState)) return;
    const centre: Point = { x: size.width / 2, y: size.height / 2 };
    const worldPoint = screenToWorld(cam.camera, centre);
    createStickyAt(worldPoint);
  }, [cam.camera, size, createStickyAt, connectionState, undoController]);

  // Handle clear selection (click on empty space)
  const handlePointerUpEmpty = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Board-level keyboard shortcuts (after the handlers they reference).
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editAllowed,
    isBusy: () => gestureStartedRef.current,
    isMarqueeActive: () => marquee.rect !== null,
    onEscape: () => {
      marquee.cancel();
      selection.clear();
    },
    onUndo: () => undoController?.undo(),
    onRedo: () => undoController?.redo(),
    isEditing: () => selection.editingId !== null,
    onToolChange: (t: any) => toolState.setTool(t),
    onCreateStickyAtCentre: handleCreateSticky,
  });

  // Story 9: create a text object at a SCREEN point (Text tool click):
  // top-left at the converted world point, tool reverts to Select, the new
  // object enters Editing immediately (PRD text.create / tool.mode).
  const handleTextCreate = useCallback((screenPoint: Point) => {
    if (!canEdit(connectionState)) return;
    const worldPoint = screenToWorld(cam.camera, screenPoint);
    const id = createText(doc, worldPoint, SESSION_ID);
    if (id) {
      undoController?.boundary();
      toolState.toolCreated(id);
      selection.startEdit(id);
    }
  }, [cam.camera, doc, selection, connectionState, toolState, undoController]);

  // Story 10: shape/connector creation callback
  const handleToolCreated = useCallback((id: string) => {
    undoController?.boundary();
    toolState.toolCreated(id);
    undoController?.boundary();
  }, [toolState, undoController]);

  // Story 9: size preset from the single-text toolbar (PRD text.size).
  // x/y are untouched; the box is re-measured in the same capture window.
  const handleTextSize = useCallback((size: TextSize) => {
    if (selection.ids.size !== 1 || !editAllowed) return;
    const [id] = selection.ids;
    undoController?.boundary();
    if (setTextSize(doc, id, size)) {
      syncTextBox(doc, id, defaultMeasurer);
    }
    undoController?.boundary();
  }, [doc, selection, editAllowed, undoController]);

  // Handle colour change from the single-note toolbar
  const handleColorChange = useCallback((color: StickyColor) => {
    if (selection.ids.size === 1 && editAllowed) {
      undoController?.boundary();
      const [id] = selection.ids;
      setStickyColor(doc, id, color);
      undoController?.boundary();
    }
  }, [doc, selection, editAllowed, undoController]);

  // Story 10: shape style handlers
  const handleShapeFill = useCallback((fill: FillColor) => {
    if (selection.ids.size !== 1 || !editAllowed) return;
    const [id] = selection.ids;
    undoController?.boundary();
    setShapeStyle(doc, id, { fill });
    undoController?.boundary();
  }, [doc, selection, editAllowed, undoController]);

  const handleShapeStroke = useCallback((stroke: StrokeColor) => {
    if (selection.ids.size !== 1 || !editAllowed) return;
    const [id] = selection.ids;
    undoController?.boundary();
    setShapeStyle(doc, id, { stroke });
    undoController?.boundary();
  }, [doc, selection, editAllowed, undoController]);

  // Handle delete from the selection bar / single-note toolbar
  const handleDelete = useCallback(() => {
    if (selection.ids.size === 0 || !editAllowed) return;
    undoController?.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController?.boundary();
  }, [doc, selection, editAllowed, undoController]);

  // Story 10: build a rects map for connector endpoint resolution
  const rectsMap = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const obj of objects) {
      m.set(obj.id, { x: obj.x, y: obj.y, width: obj.width, height: obj.height });
    }
    return m;
  }, [objects]);

  // Object props for the registry components
  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      // Story 9: with the Text tool active, clicking an existing object
      // creates text on top at that point (PRD text.create).
      if (toolState.tool === 'text' && canEdit(connectionState)) {
        handleTextCreate({ x: e.clientX, y: e.clientY });
        return;
      }
      // Story 10: Shape and Connector tools own the gesture; don't move objects.
      if (toolState.tool === 'shape' || toolState.tool === 'connector') return;
      gesture.onObjectPointerDown(e, id);
    },
    [gesture, toolState.tool, connectionState, handleTextCreate],
  );
  const onStartEdit = useCallback((id: string) => {
    if (editAllowed) selection.startEdit(id);
  }, [selection, editAllowed]);
  const onEndEdit = useCallback((next: 'selected' | 'unselected') => {
    selection.endEdit(next);
  }, [selection]);
  const onUndoBoundary = useCallback(() => undoController?.boundary(), [undoController]);
  const onUndo = useCallback(() => undoController?.undo(), [undoController]);
  const onRedo = useCallback(() => undoController?.redo(), [undoController]);

  return (
    <div ref={viewportRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomAtPointer={cam.zoomAtPointer}
        zoomStep={cam.zoomStep}
        reset={cam.reset}
        isPanning={cam.isPanning}
        onDoubleClickEmpty={handleDoubleClickEmpty}
        onPointerUpEmpty={handlePointerUpEmpty}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        textToolActive={toolState.tool === 'text'}
        onTextCreate={handleTextCreate}
        penToolActive={toolState.tool === 'pen'}
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
              zoom={cam.camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              onObjectPointerDown={onObjectPointerDown}
              onStartEdit={onStartEdit}
              onEndEdit={onEndEdit}
              onUndoBoundary={onUndoBoundary}
              onUndo={onUndo}
              onRedo={onRedo}
              {...(obj.type === 'connector' ? { rects: rectsMap } : {})}
            />
          );
        })}
        <MarqueeRect rect={marquee.rect} camera={cam.camera} />
      </BoardViewport>
      {/* Story 10: Shape tool overlay */}
      {toolState.tool === 'shape' && editAllowed && (
        <ShapeTool
          kind={toolState.shapeKind}
          camera={cam.camera}
          doc={doc!}
          createdBy={SESSION_ID}
          onCreated={handleToolCreated}
        />
      )}
      {/* Story 10: Connector tool overlay */}
      {toolState.tool === 'connector' && editAllowed && (
        <ConnectorTool
          camera={cam.camera}
          doc={doc!}
          snapshot={objects}
          createdBy={SESSION_ID}
          onCreated={handleToolCreated}
        />
      )}
      {/* Story 11: Pen tool overlay (local preview; strokes commit on
          finish). The pen stays active after each stroke. */}
      {toolState.tool === 'pen' && editAllowed && doc && (
        <PenTool
          camera={cam.camera}
          color={penOptions.color}
          thickness={penOptions.thickness}
          doc={doc}
          identityId={SESSION_ID}
          onCommitted={() => undoController?.boundary()}
          wheel={cam.wheel}
        />
      )}
      {/* Story 11: pen options toolbar (visible while Pen is active). */}
      {toolState.tool === 'pen' && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}
      {/* Story 10: Shape toolbar (when exactly one shape is selected) */}
      {selection.ids.size === 1 && (() => {
        const id = [...selection.ids][0];
        const obj = objects.find((o) => o.id === id);
        if (!obj || obj.type !== 'shape') return null;
        const shape = obj as any;
        return (
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1002 }}>
            <ShapeToolbar
              fill={shape.fill ?? 'white'}
              stroke={shape.stroke ?? 'dark'}
              onFill={handleShapeFill}
              onStroke={handleShapeStroke}
            />
          </div>
        );
      })()}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 1002 }}>
        <SelectionBar
          ids={selection.ids}
          snapshot={objects}
          onDelete={handleDelete}
          onColor={handleColorChange}
          onTextSize={handleTextSize}
        />
      </div>
      <Toolbar
        tool={toolState.tool}
        onToolChange={toolState.setTool}
        onCreateSticky={handleCreateSticky}
        disabled={!editAllowed}
        canUndo={undoState.canUndo}
        canRedo={undoState.canRedo}
        onUndo={undoState.undo}
        onRedo={undoState.redo}
        shapeKind={toolState.shapeKind}
        onShapeKindChange={toolState.setShapeKind}
      />
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </div>
  );
}
