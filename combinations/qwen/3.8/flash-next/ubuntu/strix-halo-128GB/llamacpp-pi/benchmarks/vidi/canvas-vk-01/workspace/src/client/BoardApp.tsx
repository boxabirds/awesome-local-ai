import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import * as Y from 'yjs';
import type { Point } from './canvas/camera';
import { screenToWorld, worldToScreen } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { CameraProvider, useCameraApi } from './canvas/useCamera';
import { BoardDocProvider, useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { canEdit, ConnectionStatus } from './sync/ConnectionStatus';
import { Toolbar } from './board/Toolbar';
import { useActiveTool } from './tools/useActiveTool';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { useIdentity } from './board/useIdentity';
import { NoteToolbar } from './objects/NoteToolbar';
import { ShapeToolbar } from './objects/ShapeToolbar';
import { getObjectType } from './objects/registry';
import { createSticky, deleteObject, deleteObjects, objectBounds, setStickyColor, type StickySnapshot } from '../shared/board-model';
import { createText, setTextSize } from '../shared/objects/text';
import { setShapeStyle, type ShapeSnapshot } from '../shared/objects/shape';
import type { TextSnapshot } from '../shared/objects/text';
import type { FillColor, StrokeColor } from '../shared/config';
import type { Rect } from '../shared/geometry';
import type { TextSize } from '../shared/config';
import { textMeasurer } from './objects/TextObject';
import { remeasureTextBox } from './objects/useTextBoxSync';
import { SharePanel } from './share/SharePanel';
import { createUndo } from './board/undo';
import { UndoProvider } from './board/UndoContext';
import { useUndo } from './board/useUndo';
import { UndoButtons } from './board/UndoButtons';

/** Fixed overlays that read the board camera: zoom control and first-use hint. */
export function BoardOverlays() {
  const { camera, hasNavigated, zoomStep, reset } = useCameraApi();

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

/** The connection badge, reading the state the board's provider reports. */
export function ConnectionBadge() {
  const { connection } = useBoardDoc();
  return <ConnectionStatus state={connection} />;
}

/**
 * The main board content: objects, viewport, toolbar, selection and keyboard
 * handlers. All sharing one doc and one selection state.
 */
function BoardContent() {
  const { doc, notes, connection } = useBoardDoc();
  const selection = useSelection(notes);
  const { camera } = useCameraApi();

  const editable = canEdit(connection);
  const { ids, editingId, click, toggle, setMany, clear, startEdit, endEdit } = selection;
  // A created shape or arrow is selected and the tool goes back to Select.
  const selectCreated = useCallback((id: string) => click(id), [click]);
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({
    canEdit: editable,
    select: selectCreated,
  });
  const identity = useIdentity();

  useEffect(() => {
    if (!editable && editingId !== null) endEdit();
  }, [editable, editingId, endEdit]);

  // Undo controller: one per board doc, session-only
  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undoController.destroy(), [undoController]);

  const undoState = useUndo(undoController, editable);

  const draggingRef = useRef(false);
  const gesture = useTransformGesture({
    doc,
    camera,
    snapshot: notes,
    selection: ids,
    canEdit: editable,
    onClickObject: click,
    onToggleObject: toggle,
    onGestureStart: () => {
      draggingRef.current = true;
      undoController.boundary();
    },
    onGestureEnd: () => {
      draggingRef.current = false;
      undoController.boundary();
    },
  });

  const marquee = useMarquee(camera, notes, useCallback(
    // A marquee always starts from a Shift+drag, so it adds to whatever is
    // already selected (design TC-20) rather than replacing it.
    (selected: readonly string[]) => setMany(selected, true),
    [setMany],
  ));

  const handleDblClickEmpty = useCallback(
    (worldPoint: Point) => {
      if (!editable) return;
      undoController.boundary();
      const id = createSticky(doc, worldPoint);
      undoController.boundary();
      startEdit(id);
    },
    [doc, startEdit, editable, undoController],
  );

  const handleEmptyClick = useCallback(() => {
    clear();
  }, [clear]);

  // Text tool (story 9): a click anywhere places a text object at that world
  // point, straight into editing, and the tool returns to Select.
  const handleTextToolPlace = useCallback(
    (worldPoint: Point) => {
      if (!editable) return;
      undoController.boundary();
      const id = createText(doc, worldPoint, identity.id);
      if (id === null) return;
      remeasureTextBox(doc, id, textMeasurer);
      undoController.boundary();
      startEdit(id);
      setTool('select');
    },
    [doc, editable, identity.id, startEdit, setTool, undoController],
  );

  // Size preset change: the layout (width for auto, height always) follows.
  const handleTextSize = useCallback(
    (id: string, size: TextSize) => {
      if (!editable) return;
      undoController.boundary();
      if (setTextSize(doc, id, size)) {
        remeasureTextBox(doc, id, textMeasurer);
      }
      undoController.boundary();
    },
    [doc, editable, undoController],
  );

  // Shape style swatches (`shape.style`): only the colour changes.
  const handleShapeStyle = useCallback(
    (id: string, style: { fill?: FillColor; stroke?: StrokeColor }) => {
      if (!editable) return;
      undoController.boundary();
      setShapeStyle(doc, id, style);
      undoController.boundary();
    },
    [doc, editable, undoController],
  );

  // Every attachable object's rectangle, shared by the arrows' end handles —
  // connectors themselves are never a target.
  const attachableRects = useMemo(() => {
    const rects = new Map<string, Rect>();
    for (const obj of notes) {
      if (obj.type === 'connector') continue;
      rects.set(obj.id, objectBounds(obj));
    }
    return rects;
  }, [notes]);

  const handleCreateSticky = useCallback(() => {
    if (!editable) return;
    undoController.boundary();
    const viewportEl = document.querySelector('[data-testid="board-viewport"]') as HTMLElement | null;
    if (!viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const screenCenter: Point = { x: rect.width / 2, y: rect.height / 2 };
    const worldCenter = screenToWorld(camera, screenCenter);
    const id = createSticky(doc, worldCenter);
    undoController.boundary();
    startEdit(id);
  }, [doc, camera, startEdit, editable, undoController]);

  useBoardKeys({
    doc,
    snapshot: notes,
    selection: { ids, setMany, clear },
    editingId,
    canEdit: editable,
    undoRedo: { undo: undoState.undo, redo: undoState.redo, boundary: () => undoController.boundary() },
    onCreateSticky: handleCreateSticky,
  });

  const handleColorChange = useCallback(
    (id: string, color: string) => {
      if (!editable) return;
      undoController.boundary();
      setStickyColor(doc, id, color);
      undoController.boundary();
    },
    [doc, editable, undoController],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (!editable) return;
      undoController.boundary();
      deleteObject(doc, id);
      undoController.boundary();
      clear();
    },
    [doc, clear, editable, undoController],
  );

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    undoController.boundary();
    deleteObjects(doc, Array.from(ids));
    undoController.boundary();
    clear();
  }, [doc, ids, clear, editable, undoController]);

  // Story 2's Enter-to-edit for a single selected, editable-text object.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (!editable || editingId !== null) return;
      if (event.key !== 'Enter' || ids.size !== 1) return;
      const only = Array.from(ids)[0];
      const obj = only === undefined ? undefined : notes.find((n) => n.id === only);
      const spec = obj === undefined ? undefined : getObjectType(obj.type);
      if (spec?.editableText) {
        event.preventDefault();
        startEdit(only!);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editable, editingId, ids, notes, startEdit]);

  // Stable render order (by id), independent of z-order.
  const renderedNotes = useMemo(() => [...notes].sort((a, b) => (a.id < b.id ? -1 : 1)), [notes]);

  const singleId = ids.size === 1 ? Array.from(ids)[0] : undefined;
  const selectedNote =
    singleId !== undefined && editingId === null
      ? notes.find((n) => n.id === singleId && n.type === 'sticky')
      : undefined;
  const singleText =
    singleId !== undefined && editingId === null
      ? notes.find((n) => n.id === singleId && n.type === 'text')
      : undefined;
  const singleShape =
    singleId !== undefined && editingId === null
      ? (notes.find((n) => n.id === singleId && n.type === 'shape') as ShapeSnapshot | undefined)
      : undefined;
  const overlayVisible = ids.size > 0 && !gesture.isDragging;

  return (
    <UndoProvider value={undoController}>
      <Toolbar
        onCreateSticky={handleCreateSticky}
        editable={editable}
        tool={tool}
        onSelectTool={setTool}
        shapeKind={shapeKind}
        onShapeKind={setShapeKind}
        undoButtons={<UndoButtons {...undoState} />}
      />
      <BoardViewport
        onDblClickEmpty={handleDblClickEmpty}
        onEmptyClick={handleEmptyClick}
        marqueeController={marquee.controller}
        textToolActive={tool === 'text'}
        onTextToolPlace={handleTextToolPlace}
        toolCursor={tool === 'shape' || tool === 'connector' ? 'crosshair' : undefined}
        toolLayer={
          tool === 'shape' ? (
            <ShapeTool kind={shapeKind} camera={camera} onCreated={toolCreated} />
          ) : tool === 'connector' ? (
            <ConnectorTool camera={camera} snapshot={notes} onCreated={toolCreated} />
          ) : undefined
        }
      >
        {renderedNotes.map((note) => {
          const spec = getObjectType(note.type);
          if (spec === undefined) return null;
          const Component = spec.Component;
          return (
            <Component
              key={note.id}
              obj={note}
              doc={doc}
              zoom={camera.zoom}
              camera={camera}
              rects={attachableRects}
              selected={ids.has(note.id)}
              editing={editingId === note.id}
              editable={editable}
              onStartEdit={startEdit}
              onEndEdit={(next) => {
                if (next === 'unselected') clear();
                else endEdit();
              }}
              onObjectPointerDown={gesture.onObjectPointerDown}
            />
          );
        })}
        <MarqueeRect rect={marquee.rect} />
      </BoardViewport>

      {overlayVisible && (
        <SelectionOverlay
          snapshot={notes}
          ids={ids}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
      )}

      {overlayVisible && (
        <SelectionBar
          snapshot={notes}
          ids={ids}
          camera={camera}
          onDelete={handleDeleteSelection}
          singleText={singleText as TextSnapshot | undefined}
          onTextSize={handleTextSize}
        />
      )}

      {selectedNote !== undefined && (
        <NoteToolbarOverlay
          note={selectedNote as StickySnapshot}
          camera={camera}
          onColor={handleColorChange}
          onDelete={handleDelete}
        />
      )}

      {singleShape !== undefined && (
        <ShapeToolbarOverlay
          shape={singleShape}
          camera={camera}
          onStyle={handleShapeStyle}
          onDelete={handleDelete}
        />
      )}
    </UndoProvider>
  );
}

/** Screen-space toolbar above a single selected sticky note. */
function NoteToolbarOverlay({ note, camera, onColor, onDelete }: {
  note: { id: string; x: number; y: number; color: import('../shared/config').StickyColor };
  camera: { x: number; y: number; zoom: number };
  onColor(id: string, color: string): void;
  onDelete(id: string): void;
}) {
  const screenPos = worldToScreen(camera, { x: note.x, y: note.y });
  return (
    <div
      className="note-toolbar-screen"
      style={{ left: screenPos.x, top: screenPos.y - 36 }}
    >
      <NoteToolbar
        color={note.color}
        onColor={(c) => onColor(note.id, c)}
        onDelete={() => onDelete(note.id)}
      />
    </div>
  );
}

/** Screen-space swatch toolbar above a single selected shape (story 10). */
function ShapeToolbarOverlay({ shape, camera, onStyle, onDelete }: {
  shape: ShapeSnapshot;
  camera: { x: number; y: number; zoom: number };
  onStyle(id: string, style: { fill?: FillColor; stroke?: StrokeColor }): void;
  onDelete(id: string): void;
}) {
  const screenPos = worldToScreen(camera, { x: shape.x, y: shape.y });
  return (
    <div className="note-toolbar-screen" style={{ left: screenPos.x, top: screenPos.y - 36 }}>
      <ShapeToolbar
        fill={shape.fill}
        stroke={shape.stroke}
        onFill={(color) => onStyle(shape.id, { fill: color })}
        onStroke={(color) => onStyle(shape.id, { stroke: color })}
        onDelete={() => onDelete(shape.id)}
      />
    </div>
  );
}

/** The full board application, exportable with an optional doc for testing. */
export function BoardApp({ doc, boardId }: { doc?: Y.Doc; boardId?: string } = {}): JSX.Element {
  return (
    <CameraProvider>
      <BoardDocProvider doc={doc} boardId={boardId}>
        <BoardContent />
        <BoardOverlays />
        <ConnectionBadge />
        {boardId && <SharePanel boardId={boardId} />}
      </BoardDocProvider>
    </CameraProvider>
  );
}
