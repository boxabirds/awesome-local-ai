// src/client/pages/BoardContent.tsx
// The board UI from stories 1-10.

import { useEffect, useState, useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { screenToWorld } from '../canvas/camera';
import type { Size, Camera, Point } from '../canvas/camera';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useActiveTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { createUndo } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { StickyNote } from '../objects/StickyNote';
import '../objects/registerSticky';
import { TextObject } from '../objects/TextObject';
import '../objects/registerText';
import { ShapeObject } from '../objects/ShapeObject';
import '../objects/registerShape';
import { ConnectorObject } from '../objects/ConnectorObject';
import '../objects/registerConnector';
import { StrokeObject } from '../objects/StrokeObject';
import '../objects/registerStroke';
import { ImageObject } from '../objects/ImageObject';
import '../objects/registerImage';
import { useImageInsert } from '../images/useImageInsert';
import { DropHighlight } from '../images/DropHighlight';
import { ToastContainer, useToast } from '../ui/Toast';
import type { ImageSnap } from '../../shared/objects/image';
import { createSticky, deleteObjects, objectBounds } from '../../shared/board-model';
import { createText, deleteIfEmpty, setTextBox } from '../../shared/objects/text';
import { createShape, setShapeStyle } from '../../shared/objects/shape';
import { createConnector, setConnectorEndpoint } from '../../shared/objects/connector';
import { createStroke } from '../../shared/objects/stroke';
import type { Point as WorldPoint } from '../../shared/geometry';
import { TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD } from '../../shared/config';
import { unionRects } from '../../shared/geometry';
import { worldToScreen } from '../canvas/camera';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';

// Test-only hook
declare global {
  interface Window {
    __vidi6?: {
      setCamera: (cam: Camera) => void;
      connectionState?: string;
      undo?: import('../board/undo').UndoController;
    };
  }
}

export function BoardContent(props: { boardId: string }): ReactElement {
  const { boardId } = props;

  const [viewport, setViewport] = useState<Size>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const cam = useCamera(viewport);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const editable = canEdit(connectionState);

  // Per-board undo controller (story 8)
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);
  const undoState = useUndo(undo, editable);

  // Tool state (story 10: extended with shape and connector)
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({
    onCreated: (id) => {
      selection.setMany([id], false);
    },
  });

  // Pen options (story 11)
  const penOptions = usePenOptions();

  // Image insert (story 12)
  const { message: toastMessage, show: showToast, dismiss: dismissToast } = useToast();
  const imageInsert = useImageInsert({
    doc,
    boardId,
    camera: cam.camera,
    connection: connectionState,
    identityId: 'local',
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    showToast,
  });

  // Clock tick for unfinished image detection (30s interval)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const hasUploading = notes.some(n => n.type === 'image' && (n as any).status === 'uploading');
    if (!hasUploading) return;
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [notes]);

  // Track viewport size
  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Expose test hook in test mode
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      window.__vidi6 = {
        setCamera: (c: Camera) => {
          cam.setCamera(c);
        },
        connectionState,
        undo,
      };
    }
    return () => {
      delete window.__vidi6;
    };
  }, [undo, connectionState]);

  // Marquee selection
  const marquee = useMarquee(cam.camera, notes, (ids) => {
    selection.setMany(ids, true);
  });

  // Transform gesture
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: undo.boundary,
    onGestureEnd: undo.boundary,
  });

  // Create sticky at a screen point
  const createStickyAtScreen = useCallback((screenPoint: Point) => {
    if (!canEdit(connectionState)) return;
    const worldPoint = screenToWorld(cam.camera, screenPoint);
    undo.boundary();
    const id = createSticky(doc, worldPoint);
    undo.boundary();
    if (id) {
      selection.startEdit(id);
    }
  }, [cam.camera, doc, selection, connectionState, undo]);

  // Create sticky at viewport centre
  const createStickyAtCentre = useCallback(() => {
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createStickyAtScreen(centre);
  }, [viewport, createStickyAtScreen]);

  // Create text at a screen point
  const createTextAtScreen = useCallback((screenPoint: Point) => {
    if (!canEdit(connectionState)) return;
    const worldPoint = screenToWorld(cam.camera, screenPoint);
    undo.boundary();
    const id = createText(doc, worldPoint, 'local');
    undo.boundary();
    if (id) {
      setTool('select');
      selection.setMany([id], false);
      selection.startEdit(id);
    }
  }, [cam.camera, doc, selection, connectionState, undo, setTool]);

  // Create shape (for ShapeTool)
  const createShapeAt = useCallback((rect: { x: number; y: number; width: number; height: number } | null, at: Point, square: boolean) => {
    if (!canEdit(connectionState)) return null;
    undo.boundary();
    const id = createShape(doc, { kind: shapeKind, rect, at, square }, 'local');
    undo.boundary();
    return id;
  }, [doc, shapeKind, connectionState, undo]);

  // Create connector (for ConnectorTool)
  const createConnectorAt = useCallback((from: any, to: any) => {
    if (!canEdit(connectionState)) return null;
    undo.boundary();
    const id = createConnector(doc, from, to, 'local');
    undo.boundary();
    return id;
  }, [doc, connectionState, undo]);

  // Create stroke (for PenTool)
  const createStrokeAt = useCallback((points: WorldPoint[]) => {
    if (!canEdit(connectionState)) return null;
    undo.boundary();
    const id = createStroke(doc, { points, color: penOptions.color, thickness: penOptions.thickness }, 'local');
    undo.boundary();
    return id;
  }, [doc, penOptions.color, penOptions.thickness, connectionState, undo]);

  // Re-attach connector endpoint
  const setConnectorEnd = useCallback((id: string, end: 'from' | 'to', ep: any) => {
    undo.boundary();
    const result = setConnectorEndpoint(doc, id, end, ep);
    undo.boundary();
    return result;
  }, [doc, undo]);

  // Hit test for connector tool
  const hitTestObject = useCallback((worldPoint: Point): string | null => {
    for (let i = notes.length - 1; i >= 0; i--) {
      const obj = notes[i];
      if (obj.type === 'connector') continue;
      const bounds = objectBounds(obj);
      if (
        worldPoint.x >= bounds.x &&
        worldPoint.x <= bounds.x + bounds.width &&
        worldPoint.y >= bounds.y &&
        worldPoint.y <= bounds.y + bounds.height
      ) {
        return obj.id;
      }
    }
    return null;
  }, [notes]);

  // Remeasure text box after local changes
  const remeasureText = useCallback((id: string) => {
    const objects = doc.getMap('objects');
    const obj = objects.get(id) as Y.Map<unknown> | undefined;
    if (!obj || obj.get('type') !== 'text') return;
    const ytext = obj.get('text') as Y.Text | undefined;
    if (!ytext) return;
    const text = ytext.toString();
    const size = (obj.get('size') as string) ?? 'M';
    const widthMode = (obj.get('widthMode') as string) ?? 'auto';
    const storedWidth = obj.get('width') as number | undefined;
    const fontSize = TEXT_SIZES[size as keyof typeof TEXT_SIZES] ?? 20;

    let estimatedWidth: number;
    let lineCount: number;

    if (widthMode === 'fixed' && storedWidth) {
      estimatedWidth = storedWidth;
      const charsPerLine = Math.max(1, Math.floor(storedWidth / (fontSize * 0.6)));
      const paragraphs = text.split('\n');
      lineCount = paragraphs.reduce((acc, p) => acc + Math.max(1, Math.ceil(p.length / charsPerLine)), 0);
    } else {
      const paragraphs = text.split('\n');
      const longest = paragraphs.reduce((max, p) => Math.max(max, p.length), 0);
      estimatedWidth = Math.min(longest * fontSize * 0.6, TEXT_MAX_AUTO_WIDTH_WORLD);
      lineCount = paragraphs.length;
    }

    const estimatedHeight = Math.max(1, lineCount) * fontSize * TEXT_LINE_HEIGHT;
    setTextBox(doc, id, { width: estimatedWidth, height: estimatedHeight });
  }, [doc]);

  // Keyboard commands
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable, undo, tool: tool as any, onCreateStickyAtCentre: createStickyAtCentre });

  // Handle double-click on empty board space
  const handleDblClickEmpty = useCallback((screenPoint: Point) => {
    if (tool === 'text') {
      createTextAtScreen(screenPoint);
    } else {
      createStickyAtScreen(screenPoint);
    }
  }, [tool, createStickyAtScreen, createTextAtScreen]);

  // Handle click on empty board space
  const handleClickEmpty = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Handle click on empty board space with point
  const handleClickEmptyWithPoint = useCallback((screenPoint: Point) => {
    if (tool === 'text') {
      createTextAtScreen(screenPoint);
    } else {
      selection.clear();
    }
  }, [tool, createTextAtScreen, selection]);

  // Handle double-click on a note (start editing)
  const handleNoteDblClick = useCallback((_e: React.MouseEvent, id: string) => {
    if (editable) {
      selection.startEdit(id);
    }
  }, [selection, editable]);

  // Handle end edit
  const handleEndEdit = useCallback((_next: 'selected' | 'unselected', id?: string) => {
    if (id) {
      deleteIfEmpty(doc, id);
      const objects = doc.getMap('objects');
      if (!objects.get(id)) {
        selection.clear();
        return;
      }
    }
    selection.endEdit();
  }, [doc, selection]);

  // Compute selection bar position
  const selectedObjects = notes.filter(n => selection.ids.has(n.id));
  const bbox = unionRects(selectedObjects.map(o => objectBounds(o)));
  let barStyle: React.CSSProperties | undefined;
  if (bbox && selection.ids.size > 0) {
    const topLeft = worldToScreen(cam.camera, { x: bbox.x, y: bbox.y });
    barStyle = {
      position: 'absolute',
      left: topLeft.x + (bbox.width * cam.camera.zoom) / 2,
      top: topLeft.y - 8,
      transform: 'translate(-50%, -100%)',
      zIndex: 100,
    };
  }

  // Handle delete selection
  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    undo.boundary();
    deleteObjects(doc, [...selection.ids]);
    undo.boundary();
    selection.clear();
  }, [doc, selection, editable, undo]);

  // Shape toolbar: show when exactly one shape is selected
  const selectedShape = selectedObjects.find(o => o.type === 'shape');
  let shapeToolbarStyle: React.CSSProperties | undefined;
  if (selectedShape && selection.ids.size === 1) {
    const bounds = objectBounds(selectedShape);
    const topLeft = worldToScreen(cam.camera, { x: bounds.x, y: bounds.y });
    shapeToolbarStyle = {
      position: 'absolute',
      left: topLeft.x,
      top: topLeft.y + bounds.height * cam.camera.zoom + 8,
      zIndex: 100,
    };
  }

  // Build rects map for connector rendering
  const rectsMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const obj of notes) {
      if (obj.type !== 'connector') {
        const bounds = objectBounds(obj);
        map.set(obj.id, bounds);
      }
    }
    return map;
  }, [notes]);

  // Cursor style based on active tool
  const cursorStyle = tool === 'text' ? 'text' : tool === 'shape' || tool === 'connector' ? 'crosshair' : tool === 'pen' ? 'none' : 'grab';

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomIn={cam.zoomIn}
        zoomOut={cam.zoomOut}
        reset={cam.reset}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
        onClickEmptyWithPoint={handleClickEmptyWithPoint}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        cursorStyle={cursorStyle}
        textToolActive={tool === 'text'}
        onDragOver={imageInsert.onDragOver}
        onDragEnter={imageInsert.onDragEnter}
        onDragLeave={imageInsert.onDragLeave}
        onDrop={imageInsert.onDrop}
      >
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
          }}
        >
          {notes.map((note) => {
            if (note.type === 'text') {
              return null; // Text objects rendered as HTML below
            }
            if (note.type === 'shape') {
              return (
                <ShapeObject
                  key={note.id}
                  obj={note as any}
                  doc={doc}
                  zoom={cam.camera.zoom}
                  selected={selection.ids.has(note.id)}
                  editing={selection.editingId === note.id}
                  onPointerDown={gesture.onObjectPointerDown}
                  onDblClick={handleNoteDblClick}
                  onEndEdit={(next) => handleEndEdit(next, note.id)}
                  undo={undo}
                />
              );
            }
            if (note.type === 'connector') {
              return (
                <ConnectorObject
                  key={note.id}
                  connector={note as any}
                  rects={rectsMap}
                  doc={doc}
                  selected={selection.ids.has(note.id)}
                  zoom={cam.camera.zoom}
                  onPointerDown={gesture.onObjectPointerDown}
                  setEndpoint={setConnectorEnd}
                  hitTestObject={hitTestObject}
                />
              );
            }
            if (note.type === 'stroke') {
              return (
                <StrokeObject
                  key={note.id}
                  stroke={note as any}
                  selected={selection.ids.has(note.id)}
                  onPointerDown={gesture.onObjectPointerDown}
                />
              );
            }
            return null;
          })}
        </svg>

        {/* HTML objects (sticky notes, text, images) */}
        {notes.map((note) => {
          if (note.type === 'text') {
            return (
              <TextObject
                key={note.id}
                obj={note}
                doc={doc}
                zoom={cam.camera.zoom}
                selected={selection.ids.has(note.id)}
                editing={selection.editingId === note.id}
                onPointerDown={gesture.onObjectPointerDown}
                onDblClick={handleNoteDblClick}
                onEndEdit={(next) => handleEndEdit(next, note.id)}
                undo={undo}
              />
            );
          }
          if (note.type === 'sticky') {
            return (
              <StickyNote
                key={note.id}
                note={note as any}
                doc={doc}
                zoom={cam.camera.zoom}
                selected={selection.ids.has(note.id)}
                editing={selection.editingId === note.id}
                onPointerDown={gesture.onObjectPointerDown}
                onDblClick={handleNoteDblClick}
                onEndEdit={handleEndEdit}
                undo={undo}
              />
            );
          }
          if (note.type === 'image') {
            const img = note as unknown as ImageSnap;
            return (
              <ImageObject
                key={note.id}
                image={img}
                isUploader={img.uploaderId === 'local'}
                progress={imageInsert.progress.get(note.id)}
                canRetry={imageInsert.canRetry(note.id)}
                now={now}
                onRetry={() => imageInsert.retry(note.id)}
                onRemove={() => {
                  undo.boundary();
                  deleteObjects(doc, [note.id]);
                  undo.boundary();
                }}
              />
            );
          }
          return null;
        })}

        {/* Marquee rectangle in world space */}
        <MarqueeRect rect={marquee.rect} camera={cam.camera} />
      </BoardViewport>

      {/* Selection overlay */}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />

      {/* Selection bar */}
      {barStyle && (
        <div style={barStyle}>
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            doc={doc}
            onDelete={handleDeleteSelection}
            undo={undo}
            onRemeasure={remeasureText}
          />
        </div>
      )}

      {/* Shape toolbar (when a single shape is selected) */}
      {shapeToolbarStyle && selectedShape && (
        <div style={shapeToolbarStyle}>
          <ShapeToolbar
            fill={(selectedShape as any).fill}
            stroke={(selectedShape as any).stroke}
            onFill={(c) => {
              undo.boundary();
              setShapeStyle(doc, selectedShape.id, { fill: c });
              undo.boundary();
            }}
            onStroke={(c) => {
              undo.boundary();
              setShapeStyle(doc, selectedShape.id, { stroke: c });
              undo.boundary();
            }}
          />
        </div>
      )}

      {/* Shape tool overlay */}
      {tool === 'shape' && editable && (
        <ShapeTool
          kind={shapeKind}
          camera={cam.camera}
          onCreated={(id) => toolCreated(id)}
          create={createShapeAt}
        />
      )}

      {/* Connector tool overlay */}
      {tool === 'connector' && editable && (
        <ConnectorTool
          camera={cam.camera}
          snapshot={notes}
          onCreated={(id) => toolCreated(id)}
          create={createConnectorAt}
        />
      )}

      {/* Pen tool overlay (story 11) */}
      {tool === 'pen' && editable && (
        <PenTool
          camera={cam.camera}
          color={penOptions.color}
          thickness={penOptions.thickness}
          create={createStrokeAt}
          wheel={cam.wheel}
        />
      )}

      {/* Pen toolbar (story 11) */}
      {tool === 'pen' && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}

      <Toolbar
        onCreateSticky={createStickyAtCentre}
        onOpenImagePicker={imageInsert.openPicker}
        disabled={!editable}
        undo={undoState}
        tool={tool}
        setTool={setTool}
        shapeKind={shapeKind}
        setShapeKind={setShapeKind}
      />
      <ZoomControls
        zoomPercent={cam.zoomPercent}
        canZoomIn={cam.canZoomIn}
        canZoomOut={cam.canZoomOut}
        onZoomIn={cam.zoomIn}
        onZoomOut={cam.zoomOut}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated && notes.length === 0} />

      {/* Drop highlight (story 12) */}
      {imageInsert.dragActive && <DropHighlight />}

      {/* Toast (story 12) */}
      <ToastContainer message={toastMessage} onDismiss={dismissToast} />
    </>
  );
}
