import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld, worldToScreen, type Size } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { Toolbar } from './board/Toolbar';
import { useUndo } from './board/useUndo';
import { useTool } from './board/useTool';
import { createUndo } from './board/undo';
import { StickyNote } from './objects/StickyNote';
import { TextObject } from './objects/TextObject';
import { ShapeObject } from './objects/ShapeObject';
import { ConnectorObject } from './objects/ConnectorObject';
import { StrokeObject } from './objects/StrokeObject';
import { NoteToolbar } from './objects/NoteToolbar';
import { TextToolbar } from './objects/TextToolbar';
import { ShapeToolbar } from './objects/ShapeToolbar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  LOCAL_ORIGIN,
  objectBounds,
  type ShapeObjectSnapshot,
  type ConnectorObjectSnapshot,
  type StrokeObjectSnapshot,
  type StickySnapshot,
  type TextObjectSnapshot,
} from '../shared/board-model';
import { createText, setTextSize, setTextBox } from '../shared/objects/text';
import { setShapeStyle } from '../shared/objects/shape';
import { createCanvasMeasurer, layoutText } from './objects/textLayout';
import type { StickyColor, TextSize, FillColor, StrokeColor } from '../shared/config';
import { IS_TEST_MODE } from './canvas/testHooks';
import { useActiveTool } from './tools/useActiveTool';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import type { Rect } from '../shared/geometry';

// Generate a per-session identity for createdBy
let _sessionId: string | null = null;
function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = crypto.randomUUID();
  }
  return _sessionId;
}

const measure = createCanvasMeasurer();

export function BoardApp({ boardId }: { boardId: string }) {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const editable = canEdit(connectionState);
  const toolState = useTool(editable);

  const activeToolState = useActiveTool({
    onSelect: (id) => selection.click(id),
    canEdit: editable,
  });

  const penOptions = usePenOptions();

  // Undo controller: one per board doc, destroyed on board change/unmount
  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => {
    return () => undoController.destroy();
  }, [undoController]);

  // Expose undo controller for e2e tests
  useEffect(() => {
    if (!IS_TEST_MODE) return;
    const hooks = (window as any).__vidi6 ??= {};
    hooks.undoManager = { boundary: () => undoController.boundary() };
    hooks.LOCAL_ORIGIN = LOCAL_ORIGIN;
    return () => {
      delete hooks.undoManager;
      delete hooks.LOCAL_ORIGIN;
    };
  }, [undoController]);

  const undoState = useUndo(undoController, editable);

  const [camState, setCamState] = useState({ x: 0, y: 0, zoom: 1, vw: 0, vh: 0 });
  const camRef = useRef(camState);
  camRef.current = camState;

  const handleCameraChange = useCallback(
    (cam: { x: number; y: number; zoom: number }, vp: Size) => {
      setCamState({ x: cam.x, y: cam.y, zoom: cam.zoom, vw: vp.width, vh: vp.height });
    },
    [],
  );

  const handleCreateSticky = useCallback(() => {
    if (!editable) return;
    const cam = camRef.current;
    const centre = { x: cam.vw / 2, y: cam.vh / 2 };
    const world = screenToWorld(cam, centre);
    undoController.boundary();
    const id = createSticky(doc, world);
    undoController.boundary();
    selection.click(id);
    selection.startEdit(id);
  }, [doc, selection, editable, undoController]);

  const handleDblClickEmpty = useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!editable) return;
      // Don't create sticky on dblclick when shape/connector tool is active
      if (activeToolState.tool === 'shape' || activeToolState.tool === 'connector') return;
      undoController.boundary();
      const id = createSticky(doc, worldPoint);
      undoController.boundary();
      selection.click(id);
      selection.startEdit(id);
    },
    [doc, selection, editable, undoController, activeToolState.tool],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Text tool click handler
  const handleTextClick = useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!editable) return;
      undoController.boundary();
      const id = createText(doc, worldPoint, getSessionId());
      if (!id) return;
      undoController.boundary();
      toolState.setTool('select');
      selection.startEdit(id);
    },
    [doc, selection, editable, undoController, toolState],
  );

  // Marquee
  const handleMarqueeSelect = useCallback((ids: string[]) => {
    selection.setMany(ids, true);
  }, [selection]);

  const marquee = useMarquee(camState, notes, handleMarqueeSelect);

  const handleMarqueeBegin = useCallback((screen: { x: number; y: number }) => {
    marquee.begin(screen);
  }, [marquee]);

  const handleMarqueeMove = useCallback((screen: { x: number; y: number }) => {
    marquee.move(screen);
  }, [marquee]);

  const handleMarqueeEnd = useCallback(() => {
    marquee.end();
  }, [marquee]);

  const handleMarqueeCancel = useCallback(() => {
    marquee.cancel();
  }, [marquee]);

  // Transform gesture — wire boundary to undo controller
  const gesture = useTransformGesture({
    doc,
    camera: camState,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
  });

  // Keyboard
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undoController,
    toolState,
  });

  // Enter to edit a single selected object
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (selection.editingId) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      if (e.key === 'Enter') {
        if (!editable) return;
        e.preventDefault();
        selection.startEdit(id);
      }
    },
    [selection, notes, editable],
  );

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (selection.ids.size !== 1) return;
      if (!editable) return;
      const [id] = [...selection.ids];
      undoController.boundary();
      setStickyColor(doc, id, color);
      undoController.boundary();
    },
    [doc, selection.ids, editable, undoController],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    undoController.boundary();
    deleteObjects(doc, ids);
    undoController.boundary();
    selection.clear();
  }, [doc, selection, editable, undoController]);

  const handleTextSize = useCallback(
    (size: TextSize) => {
      if (selection.ids.size !== 1) return;
      if (!editable) return;
      const [id] = [...selection.ids];
      undoController.boundary();
      setTextSize(doc, id, size);
      const objects = doc.getMap('objects') as unknown as import('yjs').Map<import('yjs').Map<unknown>>;
      const obj = objects.get(id);
      if (obj && obj.get('type') === 'text') {
        const ytext = obj.get('text') as import('yjs').Text;
        const widthMode = obj.get('widthMode') as 'auto' | 'fixed';
        const storedWidth = obj.get('width') as number;
        const fixedWidth = widthMode === 'fixed' ? storedWidth : null;
        const result = layoutText(ytext.toString(), size, widthMode, fixedWidth, measure);
        setTextBox(doc, id, { width: result.width, height: result.height });
      }
      undoController.boundary();
    },
    [doc, selection.ids, editable, undoController],
  );

  const handleShapeFill = useCallback(
    (color: FillColor) => {
      if (selection.ids.size !== 1) return;
      if (!editable) return;
      const [id] = [...selection.ids];
      undoController.boundary();
      setShapeStyle(doc, id, { fill: color });
      undoController.boundary();
    },
    [doc, selection.ids, editable, undoController],
  );

  const handleShapeStroke = useCallback(
    (color: StrokeColor) => {
      if (selection.ids.size !== 1) return;
      if (!editable) return;
      const [id] = [...selection.ids];
      undoController.boundary();
      setShapeStyle(doc, id, { stroke: color });
      undoController.boundary();
    },
    [doc, selection.ids, editable, undoController],
  );

  const handleShapeCreated = useCallback(
    (id: string) => {
      undoController.boundary();
      activeToolState.toolCreated(id);
    },
    [undoController, activeToolState],
  );

  const handleConnectorCreated = useCallback(
    (id: string) => {
      undoController.boundary();
      activeToolState.toolCreated(id);
    },
    [undoController, activeToolState],
  );

  const zoom = camState.zoom;
  const cam = camState;

  // Build rects map for connectors
  const rectsMap = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const obj of notes) {
      if (obj.type === 'connector') continue;
      const bounds = objectBounds(obj);
      m.set(obj.id, bounds);
    }
    return m;
  }, [notes]);

  // Determine if we show the single-note toolbar (sticky, text, or shape)
  const isSingleSelected = selection.ids.size === 1;
  const selectedId = isSingleSelected ? [...selection.ids][0] : null;
  const selectedObj = selectedId ? notes.find((n) => n.id === selectedId) : null;
  const showNoteToolbar = selectedObj && !selection.editingId && selectedObj.type === 'sticky';
  const showTextToolbar = selectedObj && !selection.editingId && selectedObj.type === 'text';
  const showShapeToolbar = selectedObj && !selection.editingId && selectedObj.type === 'shape';

  let noteToolbarStyle: React.CSSProperties | undefined;
  if (selectedObj && (showNoteToolbar || showTextToolbar || showShapeToolbar)) {
    const bounds = objectBounds(selectedObj);
    const screenPt = worldToScreen(cam, { x: bounds.x + bounds.width / 2, y: bounds.y });
    noteToolbarStyle = {
      position: 'fixed' as const,
      left: screenPt.x,
      top: screenPt.y - 40,
      transform: 'translateX(-50%)',
      zIndex: 1000,
    };
  }

  // Selection bar position (for 2+ selected)
  let selectionBarStyle: React.CSSProperties | undefined;
  if (selection.ids.size >= 2 && notes.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity;
    for (const note of notes) {
      if (!selection.ids.has(note.id)) continue;
      const bounds = objectBounds(note);
      if (bounds.x < minX) minX = bounds.x;
      if (bounds.y < minY) minY = bounds.y;
      if (bounds.x + bounds.width > maxX) maxX = bounds.x + bounds.width;
    }
    const topLeft = worldToScreen(cam, { x: minX, y: minY });
    const topRight = worldToScreen(cam, { x: maxX, y: minY });
    selectionBarStyle = {
      position: 'fixed' as const,
      left: (topLeft.x + topRight.x) / 2,
      top: topLeft.y - 40,
      transform: 'translateX(-50%)',
      zIndex: 1000,
    };
  }

  return (
    <div onKeyDown={handleKeyDown} data-testid="app-root" tabIndex={-1}>
      <ConnectionStatus state={connectionState} />
      <Toolbar
        onCreateSticky={handleCreateSticky}
        disabled={!editable}
        undoState={undoState}
        tool={toolState.tool}
        onToolChange={toolState.setTool}
        activeTool={activeToolState.tool}
        shapeKind={activeToolState.shapeKind}
        onActiveToolChange={activeToolState.setTool}
        onShapeKindChange={activeToolState.setShapeKind}
      />
      <BoardViewport
        onDblClickEmpty={handleDblClickEmpty}
        onEmptyClick={handleEmptyClick}
        onCameraChange={handleCameraChange}
        onMarqueeBegin={handleMarqueeBegin}
        onMarqueeMove={handleMarqueeMove}
        onMarqueeEnd={handleMarqueeEnd}
        onMarqueeCancel={handleMarqueeCancel}
        textToolActive={toolState.tool === 'text' && activeToolState.tool === 'select'}
        onTextClick={handleTextClick}
        penToolActive={activeToolState.tool === 'pen'}
        penOverlay={activeToolState.tool === 'pen' && editable ? (
          <PenTool
            camera={camState}
            color={penOptions.color}
            thickness={penOptions.thickness}
            doc={doc}
            identityId={getSessionId()}
            onCommit={() => undoController.boundary()}
          />
        ) : undefined}
      >
        {notes.map((note) => {
          if (note.type === 'stroke') {
            return (
              <StrokeObject
                key={note.id}
                stroke={note as StrokeObjectSnapshot}
                selected={selection.ids.has(note.id)}
                zoom={zoom}
                camera={camState}
                onSelect={(id) => selection.click(id)}
                onToggleSelect={(id) => selection.toggle(id)}
                onObjectPointerDown={gesture.onObjectPointerDown}
              />
            );
          }
          if (note.type === 'connector') {
            return (
              <ConnectorObject
                key={note.id}
                connector={note as ConnectorObjectSnapshot}
                rects={rectsMap}
                doc={doc}
                selected={selection.ids.has(note.id)}
                zoom={zoom}
                camera={camState}
                snapshot={notes}
                onSelect={(id) => selection.click(id)}
                onBoundary={undoController.boundary}
              />
            );
          }
          if (note.type === 'shape') {
            return (
              <ShapeObject
                key={note.id}
                shape={note as ShapeObjectSnapshot}
                doc={doc}
                zoom={zoom}
                selected={selection.ids.has(note.id)}
                editing={note.id === selection.editingId}
                editable={editable}
                onSelect={(id) => selection.click(id)}
                onToggleSelect={(id) => selection.toggle(id)}
                onStartEdit={(id) => selection.startEdit(id)}
                onEndEdit={() => selection.endEdit()}
                onObjectPointerDown={gesture.onObjectPointerDown}
                undoController={undoController}
              />
            );
          }
          if (note.type === 'text') {
            return (
              <TextObject
                key={note.id}
                obj={note as TextObjectSnapshot}
                doc={doc}
                zoom={zoom}
                selected={selection.ids.has(note.id)}
                editing={note.id === selection.editingId}
                editable={editable}
                onSelect={(id) => selection.click(id)}
                onToggleSelect={(id) => selection.toggle(id)}
                onStartEdit={(id) => selection.startEdit(id)}
                onEndEdit={() => selection.endEdit()}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onClearSelection={() => selection.clear()}
                undoController={undoController}
              />
            );
          }
          return (
            <StickyNote
              key={note.id}
              note={note as StickySnapshot}
              doc={doc}
              zoom={zoom}
              selected={selection.ids.has(note.id)}
              editing={note.id === selection.editingId}
              editable={editable}
              onSelect={(id) => selection.click(id)}
              onToggleSelect={(id) => selection.toggle(id)}
              onStartEdit={(id) => selection.startEdit(id)}
              onEndEdit={() => selection.endEdit()}
              onObjectPointerDown={gesture.onObjectPointerDown}
              undoController={undoController}
            />
          );
        })}
        <MarqueeRect rect={marquee.rect} camera={camState} />
      </BoardViewport>

      {/* Shape tool overlay - outside viewport to avoid transform issues */}
      {activeToolState.tool === 'shape' && editable && (
        <ShapeTool
          kind={activeToolState.shapeKind}
          camera={camState}
          doc={doc}
          onCreated={handleShapeCreated}
          onBoundary={undoController.boundary}
        />
      )}

      {/* Connector tool overlay - outside viewport to avoid transform issues */}
      {activeToolState.tool === 'connector' && editable && (
        <ConnectorTool
          camera={camState}
          snapshot={notes}
          doc={doc}
          onCreated={handleConnectorCreated}
          onBoundary={undoController.boundary}
        />
      )}

      {/* Pen toolbar - visible while pen is active */}
      {activeToolState.tool === 'pen' && editable && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}

      {/* Selection overlay (handles) */}
      {!selection.editingId && selection.ids.size >= 1 && (
        <SelectionOverlay
          ids={selection.ids}
          snapshot={notes}
          camera={camState}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
      )}

      {/* Selection bar for 2+ objects */}
      {selection.ids.size >= 2 && !selection.editingId && (
        <div style={selectionBarStyle}>
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            onDelete={handleDelete}
          />
        </div>
      )}

      {/* Note toolbar for single sticky */}
      {showNoteToolbar && selectedObj && (
        <div style={noteToolbarStyle}>
          <NoteToolbar color={(selectedObj as StickySnapshot).color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      )}

      {/* Text toolbar for single text object */}
      {showTextToolbar && selectedObj && (
        <div style={noteToolbarStyle}>
          <TextToolbar
            size={(selectedObj as TextObjectSnapshot).size}
            onSize={handleTextSize}
            onDelete={handleDelete}
          />
        </div>
      )}

      {/* Shape toolbar for single shape */}
      {showShapeToolbar && selectedObj && (
        <div style={noteToolbarStyle}>
          <ShapeToolbar
            fill={(selectedObj as ShapeObjectSnapshot).fill}
            stroke={(selectedObj as ShapeObjectSnapshot).stroke}
            onFill={handleShapeFill}
            onStroke={handleShapeStroke}
          />
        </div>
      )}
    </div>
  );
}
