import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createSticky, deleteObjects, setStickyColor, storedRects } from '../../shared/board-model';
import { setShapeStyle } from '../../shared/objects/shape';
import { createText, setTextSize } from '../../shared/objects/text';
import { localAuthor } from '../objects/TextObject';
import { getTextMeasurer } from '../objects/textLayout';
import { remeasureText } from '../objects/useTextBoxSync';
import { useActiveTool } from '../tools/useActiveTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { ShapeTool } from '../tools/ShapeTool';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useBoardKeys } from './useBoardKeys';
import { MarqueeRect, useMarquee } from './Marquee';
import { SelectionAnnouncer, SelectionBar } from './SelectionBar';
import { SelectionOverlay, selectionBounds, toScreenRect } from './SelectionOverlay';
import { useSelection } from './useSelection';
import { useTransformGesture, type TransformPhase } from './useTransformGesture';
import { createUndo, NO_UNDO, type UndoController } from './undo';
import { UndoButtons } from './UndoButtons';
import { UndoContext, useUndo } from './useUndo';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from '../canvas/camera';
import { CameraContext, useCamera, type CameraContextValue } from '../canvas/useCamera';
import { getObjectType, type ObjectGesturePhase } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { installTestHooks } from '../testHooks';
import type { FillColor, StickyColor, StrokeColor, TextSize } from '../../shared/config';
import type * as Y from 'yjs';

/** A board that could not be loaded is never editable (it would look empty). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

const HALF = 2;

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The stories 1–4 board (canvas, notes, live sync); BoardPage mounts it once the board exists. */
export function Board({ boardId, children }: { boardId: string; children?: ReactNode }) {
  const [viewport, setViewport] = useState<Size>(windowSize);
  const api = useCamera(viewport);
  const { camera } = api;
  const { doc, objects, connection } = useBoardDoc(boardId);
  const undoController = useUndoControllerFor(doc);
  const selection = useSelection(objects);
  const { ids: selectedIds, editingId, clear, setMany, startEdit, endEdit, click } = selection;

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const editable = canEdit(connection);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return installTestHooks({
      setCamera: api.setCamera,
      getCamera: () => cameraRef.current,
      doc,
      get connectionState() {
        return connectionRef.current;
      },
    });
  }, [api.setCamera, doc]);

  const ctx = useMemo<CameraContextValue>(() => ({ api, onViewportResize: setViewport }), [api]);

  // Losing the board mid-edit ends the edit (nothing more can be saved into it).
  useEffect(() => {
    if (!editable && editingId !== null) endEdit();
  }, [editable, editingId, endEdit]);

  const createAt = useCallback(
    (world: Point) => {
      if (!editableRef.current) return;
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id) startEdit(id);
    },
    [doc, startEdit, undoController],
  );

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const onCreateSticky = useCallback(() => {
    if (!editableRef.current) return;
    const size = viewportRef.current;
    createAt(screenToWorld(cameraRef.current, { x: size.width / HALF, y: size.height / HALF }));
  }, [createAt]);

  // Story 9: the Text tool places a text object where the board is pressed.
  // Story 10: Shape and Connector tools select what they create and return to Select.
  const tool = useActiveTool({ canEdit: editable, select: click });
  const { setTool } = tool;
  const placeText = useCallback(
    (world: Point) => {
      setTool('select');
      if (!editableRef.current) return;
      undoController.boundary();
      const id = createText(doc, world, localAuthor(doc));
      undoController.boundary();
      if (id) startEdit(id);
    },
    [doc, setTool, startEdit, undoController],
  );

  const setSize = useCallback(
    (id: string, size: TextSize) => {
      if (!editableRef.current) return;
      undoController.boundary();
      // Top-left stays; the box is re-measured in the same undo step.
      if (setTextSize(doc, id, size)) remeasureText(doc, id, getTextMeasurer());
      undoController.boundary();
    },
    [doc, undoController],
  );

  const setShapeStyleFor = useCallback(
    (id: string, style: { fill?: FillColor; stroke?: StrokeColor }) => {
      if (!editableRef.current) return;
      undoController.boundary();
      setShapeStyle(doc, id, style);
      undoController.boundary();
    },
    [doc, undoController],
  );

  const deleteSelection = useCallback(() => {
    if (!editableRef.current) return;
    undoController.boundary();
    deleteObjects(doc, [...selectedIds]);
    undoController.boundary();
    clear();
  }, [doc, selectedIds, clear, undoController]);

  const setColor = useCallback(
    (id: string, color: StickyColor) => {
      if (!editableRef.current) return;
      undoController.boundary();
      setStickyColor(doc, id, color);
      undoController.boundary();
    },
    [doc, undoController],
  );

  const onEndEdit = useCallback(
    (next: 'selected' | 'unselected') => (next === 'selected' ? endEdit() : clear()),
    [endEdit, clear],
  );

  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable, undo: undoController, tool, onCreateSticky });
  const history = useUndo(undoController, editable);
  const marquee = useMarquee(camera, objects, (ids) => setMany(ids, true));
  // A whole drag or resize (all its frames) is one undo step.
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
  });

  // Arrows resolve their ends from the attachable objects' current rects (story 10).
  const rects = useMemo(() => storedRects(objects), [objects]);

  const busy = gesture.phase === 'moving' || gesture.phase === 'resizing';
  const box = selectionBounds(selectedIds, objects);
  const screenBox = box ? toScreenRect(camera, box) : null;
  const showControls = editable && editingId === null;

  const overlay = (
    <>
      <SelectionOverlay
        ids={selectedIds}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
        showHandles={showControls}
      />
      {showControls && !busy && screenBox && (
        <div
          className="selection-bar-anchor"
          style={{ left: screenBox.x + screenBox.width / HALF, top: screenBox.y }}
        >
          <SelectionBar
            ids={selectedIds}
            snapshot={objects}
            onDelete={deleteSelection}
            onColor={setColor}
            onTextSize={setSize}
            onShapeStyle={setShapeStyleFor}
          />
        </div>
      )}
      {editable && tool.tool === 'shape' && (
        <ShapeTool kind={tool.shapeKind} camera={camera} doc={doc} onCreated={tool.toolCreated} />
      )}
      {editable && tool.tool === 'connector' && (
        <ConnectorTool camera={camera} snapshot={objects} doc={doc} onCreated={tool.toolCreated} />
      )}
    </>
  );

  return (
    <CameraContext.Provider value={ctx}>
      <UndoContext.Provider value={undoController}>
        <main className="app">
          <BoardViewport
            onEmptyDoubleClick={createAt}
            onEmptyClick={clear}
            marquee={marquee}
            overlay={overlay}
            tool={tool.tool}
            onToolClick={placeText}
          >
            {renderOrder(objects).map(({ note: obj, zIndex }) => {
              const spec = getObjectType(obj.type);
              if (!spec) return null;
              const { Component } = spec;
              return (
                <Component
                  key={obj.id}
                  object={obj}
                  doc={doc}
                  zIndex={zIndex}
                  selected={selectedIds.has(obj.id)}
                  editing={editable && obj.id === editingId}
                  readOnly={!editable}
                  gesture={objectGesture(gesture.phase, gesture.activeIds.has(obj.id))}
                  onPointerDown={gesture.onObjectPointerDown}
                  onStartEdit={startEdit}
                  onEndEdit={onEndEdit}
                  zoom={camera.zoom}
                  rects={rects}
                />
              );
            })}
            <MarqueeRect rect={marquee.rect} camera={camera} />
          </BoardViewport>
          <SelectionAnnouncer count={selectedIds.size} />
          <Toolbar
            onCreateSticky={onCreateSticky}
            disabled={!editable}
            tool={tool.tool}
            onTool={setTool}
            shapeKind={tool.shapeKind}
            onShapeKind={tool.setShapeKind}
          >
            <UndoButtons {...history} />
          </Toolbar>
          <ZoomControls
            zoomPercent={zoomPercent(camera)}
            canZoomIn={canZoomIn(camera)}
            canZoomOut={canZoomOut(camera)}
            onZoomIn={() => api.zoomStep('in')}
            onZoomOut={() => api.zoomStep('out')}
            onReset={api.reset}
          />
          <NavigationHint visible={!api.hasNavigated} />
          <ConnectionStatus state={connection} />
          {children}
        </main>
      </UndoContext.Provider>
    </CameraContext.Provider>
  );
}

/**
 * One undo controller per board doc (undo.history), created when the board
 * mounts and destroyed on board change or unmount, so history is session-only.
 */
function useUndoControllerFor(doc: Y.Doc): UndoController {
  const [current, setCurrent] = useState<{ doc: Y.Doc; controller: UndoController } | null>(null);
  useEffect(() => {
    const controller = createUndo(doc);
    setCurrent({ doc, controller });
    return () => controller.destroy();
  }, [doc]);
  return current?.doc === doc ? current.controller : NO_UNDO;
}

function objectGesture(phase: TransformPhase, active: boolean): ObjectGesturePhase {
  if (!active) return 'idle';
  if (phase === 'pressed') return 'pressed';
  return phase === 'moving' ? 'dragging' : 'idle';
}

/**
 * Stacking comes from the snapshot's (z, id) order via z-index, while DOM order
 * stays stable (by id) so bringing a note to front never re-parents the element
 * holding the pointer capture of a drag.
 */
function renderOrder<T extends { id: string }>(sorted: readonly T[]): { note: T; zIndex: number }[] {
  return sorted
    .map((note, i) => ({ note, zIndex: i + 1 }))
    .sort((a, b) => (a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0));
}
