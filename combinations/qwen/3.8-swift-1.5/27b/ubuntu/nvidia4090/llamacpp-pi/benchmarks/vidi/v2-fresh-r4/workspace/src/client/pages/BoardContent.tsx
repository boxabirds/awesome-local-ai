/**
 * Board content: the stories 1–7 board UI with the Share panel.
 * Only mounted when the board exists (BoardPage state = ready).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { type Size, canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point } from '../canvas/camera';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { ZoomControls } from '../canvas/ZoomControls';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useUndoController, useUndo } from '../board/useUndo';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { useBoardKeys } from '../board/useBoardKeys';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { useActiveTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { StickyNote } from '../objects/StickyNote';
import { TextObject } from '../objects/TextObject';
import { ShapeObject } from '../objects/ShapeObject';
import { ConnectorObject } from '../objects/ConnectorObject';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { setConnectionState } from '../canvas/testHooks';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  setStickyColor,
  type ConnectorSnapshot,
  type ShapeSnapshot,
} from '../../shared/board-model';
import { unionRects, type Rect } from '../../shared/geometry';
import { createText } from '../../shared/objects/text';
import { setShapeStyle } from '../../shared/objects/shape';
import { SharePanel } from '../share/SharePanel';
import type { FillColor, StickyColor, StrokeColor, TextSize } from '../../shared/config';
import { LOCAL_USER_ID } from '../../shared/config';

export function BoardContent({ boardId }: { boardId: string }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const camera = useCamera(viewport);

  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const editable = connectionState !== 'load_failed';

  const selection = useSelection(notes);

  // Current bounds of all objects (story 10): connector endpoint resolution
  // and tool hit tests resolve against these.
  const rects = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const s of notes) m.set(s.id, objectBounds(s));
    return m;
  }, [notes]);

  // Active board tool (story 9/10): select / text / shape / connector with
  // keyboard shortcuts (v, t, s, l, n, Escape). (`createStickyAt` and
  // `screenPointToWorld`-level helpers are defined below; the sticky
  // shortcut is inlined here to keep this hook call early.)
  const {
    tool,
    shapeKind,
    setTool,
    setShapeKind,
    toolCreated,
  } = useActiveTool({
    select: (id) => selection.click(id),
    onStickyNote: () => {
      const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
      createStickyAt(screenToWorld(camera.camera, centre));
    },
  });

  // Per-user undo history (story 8): session-only, LOCAL_ORIGIN changes only.
  const undoController = useUndoController(doc);
  const undo = useUndo(undoController, editable);

  // A shape/connector was created: one undo step, select it, back to Select.
  const handleToolCreated = useCallback(
    (id: string) => {
      undo.boundary();
      toolCreated(id);
    },
    [undo, toolCreated],
  );

  // Shape style change (its own undo step — story 10).
  const handleShapeStyle = useCallback(
    (id: string, style: { fill?: FillColor; stroke?: StrokeColor }) => {
      undo.boundary();
      setShapeStyle(doc, id, style);
    },
    [doc, undo],
  );

  // Expose connection state on the test hook
  useEffect(() => {
    setConnectionState(connectionState);
  }, [connectionState]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    return undefined;
  }, []);

  const screenPointToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = rootRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      return screenToWorld(camera.camera, { x: sx, y: sy });
    },
    [camera.camera],
  );

  const createStickyAt = useCallback(
    (worldPoint: Point) => {
      if (!editable) return;
      undo.boundary();
      const id = createSticky(doc, worldPoint);
      if (id) {
        selection.startEdit(id);
      }
    },
    [doc, selection, editable, undo],
  );

  const createTextAt = useCallback(
    (worldPoint: Point) => {
      if (!editable) return;
      undo.boundary();
      const id = createText(doc, worldPoint, LOCAL_USER_ID);
      if (id) {
        selection.startEdit(id);
        setTool('select');
      }
    },
    [doc, selection, editable, undo],
  );

  const handleDblClickEmpty = useCallback(
    (clientX: number, clientY: number) => {
      const world = screenPointToWorld(clientX, clientY);
      // The text tool places text on double-click too
      if (tool === 'text') {
        createTextAt(world);
        return;
      }
      createStickyAt(world);
    },
    [screenPointToWorld, createStickyAt, createTextAt, tool],
  );

  const handleClickEmpty = useCallback(
    (clientX: number, clientY: number) => {
      if (tool === 'text') {
        createTextAt(screenPointToWorld(clientX, clientY));
        return;
      }
      selection.clear();
    },
    [tool, createTextAt, screenPointToWorld, selection],
  );

  // Text tool: clicking anywhere (including over objects) places a text
  // object. Capture phase so the object's own handlers never run.
  const handleTextToolPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (tool !== 'text' || !editable) return;
      e.stopPropagation();
      createTextAt(screenPointToWorld(e.clientX, e.clientY));
    },
    [tool, editable, createTextAt, screenPointToWorld],
  );

  const handleCreateSticky = useCallback(() => {
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    const world = screenToWorld(camera.camera, centre);
    createStickyAt(world);
  }, [viewport, camera.camera, createStickyAt]);

  // Transform gesture (each drag/resize is one undo step — story 8)
  const gesture = useTransformGesture({
    doc,
    camera: camera.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: undo.boundary,
    onGestureEnd: undo.boundary,
  });

  // Marquee
  const marquee = useMarquee(camera.camera, notes, (ids) => {
    selection.setMany(ids, true);
  });

  // Keyboard
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    onUndo: undo.undo,
    onRedo: undo.redo,
    onBoundary: undo.boundary,
    onActivateTextTool: (active) => setTool(active ? 'text' : 'select'),
    onCreateStickyNote: handleCreateSticky,
  });

  // Handle for double-click on a note (start editing)
  const handleNoteDoubleClick = useCallback(
    (_e: React.MouseEvent, id: string) => {
      if (editable) {
        selection.startEdit(id);
      }
    },
    [selection, editable],
  );

  // Selection bar delete (its own undo step — story 8)
  const handleSelectionDelete = useCallback(() => {
    undo.boundary();
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, undo]);

  // Selection bar color change (its own undo step — story 8)
  const handleColorChange = useCallback(
    (id: string, color: StickyColor) => {
      undo.boundary();
      setStickyColor(doc, id, color);
    },
    [doc, undo],
  );

  // Text size change (its own undo step — story 9). The TextToolbar already
  // applied setTextSize; the boundary closes the step it landed in.
  const handleTextSize = useCallback(
    (_id: string, _size: TextSize) => {
      undo.boundary();
    },
    [undo],
  );

  // Delete a single text object (its own undo step — story 9)
  const handleTextDelete = useCallback(
    (id: string) => {
      undo.boundary();
      deleteObjects(doc, [id]);
      selection.clear();
    },
    [doc, selection, undo],
  );

  // Screen-space anchor for the selection toolbars: the top-centre of the
  // selection bounding box (the toolbars float just above it).
  const selectedSnaps = notes.filter((n) => selection.ids.has(n.id));
  const selectionBox = selectedSnaps.length > 0 ? unionRects(selectedSnaps.map(objectBounds)) : undefined;
  const barAnchor = selectionBox
    ? {
        x: (selectionBox.x + selectionBox.width / 2 - camera.camera.x) * camera.camera.zoom,
        y: (selectionBox.y - camera.camera.y) * camera.camera.zoom,
      }
    : undefined;

  // Marquee handlers for the viewport
  const handleMarqueeBegin = useCallback(
    (screenPoint: Point) => {
      marquee.begin(screenPoint);
    },
    [marquee],
  );

  const handleMarqueeMove = useCallback(
    (screenPoint: Point) => {
      marquee.move(screenPoint);
    },
    [marquee],
  );

  const handleMarqueeEnd = useCallback(() => {
    marquee.end();
  }, [marquee]);

  const handleMarqueeCancel = useCallback(() => {
    marquee.cancel();
  }, [marquee]);

  return (
    <div className="app-root" ref={rootRef}>
      <BoardViewport
        camera={camera.camera}
        hasNavigated={camera.hasNavigated}
        beginPan={camera.beginPan}
        panMove={camera.panMove}
        endPan={camera.endPan}
        wheel={camera.wheel}
        zoomStep={camera.zoomStep}
        reset={camera.reset}
        tool={tool}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
        onShiftPointerDownEmpty={handleMarqueeBegin}
        onShiftPointerMove={handleMarqueeMove}
        onShiftPointerUp={handleMarqueeEnd}
        onShiftPointerCancel={handleMarqueeCancel}
      >
        <div className="board-objects" onPointerDownCapture={handleTextToolPointerDown}>
          {notes.map((note) => {
            if (note.type === 'text') {
              return (
                <TextObject
                  key={note.id}
                  obj={note}
                  doc={doc}
                  selected={selection.ids.has(note.id)}
                  editing={selection.editingId === note.id}
                  onPointerDown={gesture.onObjectPointerDown}
                  onDoubleClick={handleNoteDoubleClick}
                  onEndEdit={() => selection.endEdit()}
                  onBoundary={undo.boundary}
                  onUndo={undo.undo}
                  onRedo={undo.redo}
                />
              );
            }
            if (note.type === 'shape') {
              const shape = note as ShapeSnapshot;
              return (
                <ShapeObject
                  key={note.id}
                  shape={shape}
                  doc={doc}
                  selected={selection.ids.has(note.id)}
                  editing={selection.editingId === note.id}
                  onPointerDown={gesture.onObjectPointerDown}
                  onDoubleClick={handleNoteDoubleClick}
                  onEndEdit={() => selection.endEdit()}
                  onBoundary={undo.boundary}
                  onUndo={undo.undo}
                  onRedo={undo.redo}
                />
              );
            }
            if (note.type === 'connector') {
              const connector = note as ConnectorSnapshot;
              return (
                <ConnectorObject
                  key={note.id}
                  connector={connector}
                  rects={rects}
                  snapshot={notes}
                  doc={doc}
                  selected={selection.ids.has(note.id)}
                  zoom={camera.camera.zoom}
                  camera={camera.camera}
                  onPointerDown={gesture.onObjectPointerDown}
                  onBoundary={undo.boundary}
                />
              );
            }
            return (
              <StickyNote
                key={note.id}
                obj={note}
                doc={doc}
                zoom={camera.camera.zoom}
                selected={selection.ids.has(note.id)}
                editing={selection.editingId === note.id}
                onPointerDown={gesture.onObjectPointerDown}
                onDoubleClick={handleNoteDoubleClick}
                onEndEdit={() => selection.endEdit()}
                onBoundary={undo.boundary}
                onUndo={undo.undo}
                onRedo={undo.redo}
              />
            );
          })}
        </div>
      </BoardViewport>

      {/* Shape / connector tool overlays (screen space, story 10) */}
      {tool === 'shape' && editable && (
        <ShapeTool kind={shapeKind} camera={camera.camera} doc={doc} onCreated={handleToolCreated} />
      )}
      {tool === 'connector' && editable && (
        <ConnectorTool
          camera={camera.camera}
          snapshot={notes}
          rects={rects}
          doc={doc}
          onCreated={handleToolCreated}
        />
      )}

      {/* Marquee rectangle (screen space) */}
      <MarqueeRect rect={marquee.rect} camera={camera.camera} />

      {/* Selection overlay with handles (screen space) */}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />

      {/* Selection bar (screen space), anchored above the selection bbox */}
      <div
        className="selection-bar-container"
        data-vidi6="selection-bar-container"
        style={barAnchor ? { position: 'absolute', left: barAnchor.x, top: barAnchor.y, width: 0, height: 0 } : undefined}
      >
        <SelectionBar
          ids={selection.ids}
          snapshot={notes}
          doc={doc}
          onDelete={handleSelectionDelete}
          onColorChange={handleColorChange}
          onTextSize={handleTextSize}
          onTextDelete={handleTextDelete}
          onShapeStyle={handleShapeStyle}
          onUndo={undo.undo}
          onRedo={undo.redo}
        />
      </div>

      <Toolbar
        onCreateSticky={handleCreateSticky}
        onToolText={() => setTool('text')}
        onToolSelect={() => setTool('select')}
        onToolShape={() => setTool('shape')}
        onToolConnector={() => setTool('connector')}
        activeTool={tool}
        shapeKind={shapeKind}
        onShapeKind={setShapeKind}
        disabled={!editable}
        undo={undo}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera.camera)}
        canZoomIn={canZoomIn(camera.camera)}
        canZoomOut={canZoomOut(camera.camera)}
        onZoomIn={() => camera.zoomStep('in')}
        onZoomOut={() => camera.zoomStep('out')}
        onReset={camera.reset}
      />
      <NavigationHint visible={!camera.hasNavigated && notes.length === 0} />
      <ConnectionStatus state={connectionState} />
      <SharePanel boardId={boardId} />
    </div>
  );
}
