import { useCallback, useEffect, useRef, useState } from 'react';
import { createSticky, deleteObjects, objectBounds, setStickyColor } from '../shared/board-model';
import type { Rect } from '../shared/geometry';
import { setShapeStyle } from '../shared/objects/shape';
import { createText, setTextSize } from '../shared/objects/text';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useBoardKeys } from './board/useBoardKeys';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { type UndoController, createUndo } from './board/undo';
import { UndoContext, useUndo } from './board/useUndo';
import { BoardViewport } from './canvas/BoardViewport';
import { DropHighlight } from './images/DropHighlight';
import { useImageInsert } from './images/useImageInsert';
import { ImageContext } from './objects/ImageObject';
import { Toast, useToasts } from './ui/Toast';
import { type Camera, type Point, type Size, screenToWorld } from './canvas/camera';
import { getObjectType } from './objects/registry';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { usePenOptions } from './tools/usePenOptions';
import { ShapeTool } from './tools/ShapeTool';
import { type ToolId, useActiveTool } from './tools/useActiveTool';
import { syncTextBox } from './objects/useTextBoxSync';
import { textMeasurer } from './objects/textLayout';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import type * as Y from 'yjs';

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

let tabIdentity: string | null = null;
/**
 * Who creates objects in this tab (`createdBy`). Story 6 (people's identities) is not part of
 * this build, so each tab has its own anonymous guest id.
 */
function localIdentity(): string {
  tabIdentity ??= `g_${crypto.randomUUID()}`;
  return tabIdentity;
}

/** The app: Home (`/`), a board (`/b/:id`) or Board not found (anything else). */
export function Root() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}

/**
 * Whether the board may be changed. Only a board that could not be loaded is locked: its
 * saved content is unknown, so it must not be presented as an empty editable board.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * The board (stories 1–4). `boardId` connects the board to its live room; without it (component tests) the board is
 * local only. `doc` lets tests supply the board document; the app creates its own.
 */
export function App(props: { boardId?: string; doc?: Y.Doc }) {
  const { doc, objects, connection } = useBoardDoc(props.boardId, props.doc);
  const selection = useSelection(objects);
  const { startEdit, endEdit, click, setMany, clear, selectNew } = selection;
  const editable = canEdit(connection);
  const cameraRef = useRef<Camera | null>(null);
  const viewportRef = useRef<Size | null>(null);
  const getCamera = useCallback(() => cameraRef.current ?? INITIAL_CAMERA, []);
  const tool = useActiveTool({ canEdit: editable, select: selectNew });
  const pen = usePenOptions();
  const toasts = useToasts();

  // One undo history per board document, for this tab only: gone on board change or reload.
  const [history, setHistory] = useState<UndoController | null>(null);
  useEffect(() => {
    const controller = createUndo(doc);
    setHistory(controller);
    return () => {
      controller.destroy();
      setHistory(null);
    };
  }, [doc]);
  const undo = useUndo(history, editable);
  const boundary = useCallback(() => history?.boundary(), [history]);

  // Images (story 12): drop, paste and the Image tool's picker; the tool is active only while
  // the picker is open.
  const images = useImageInsert({
    doc,
    boardId: props.boardId ?? '',
    camera: getCamera,
    viewport: () => viewportRef.current ?? { width: window.innerWidth, height: window.innerHeight },
    connection,
    identityId: localIdentity(),
    canEdit: editable,
    notify: toasts.show,
    boundary,
    onPickerClose: () => tool.setTool('select'),
  });
  const setTool = (t: ToolId) => {
    if (t !== 'image') tool.setTool(t);
    else if (editable && images.openPicker()) tool.setTool('image');
  };
  const toolControls = { ...tool, setTool };
  /** Runs one user action as its own undo step. */
  const step = <T,>(fn: () => T): T => {
    boundary();
    try {
      return fn();
    } finally {
      boundary();
    }
  };

  // Objects of a registered type are shown; others (from newer clients) are left alone.
  const shown = objects.filter((o) => getObjectType(o.type) !== undefined);
  // Nothing is edited while the board is locked.
  const editingId = editable ? selection.editingId : null;

  const transform = useTransformGesture({
    doc,
    camera: getCamera,
    selection,
    snapshot: shown,
    canEdit: editable,
    onGestureStart: boundary,
    onGestureEnd: boundary,
  });

  const imageContext = {
    identityId: localIdentity(),
    progress: images.progress,
    canRetry: images.canRetry,
    retry: images.retry,
    remove: (id: string) => {
      if (editable) step(() => deleteObjects(doc, [id]));
    },
  };

  const deleteSelection = () => {
    if (!editable) return;
    step(() => deleteObjects(doc, [...selection.ids]));
    clear();
  };

  // Stacking follows (z, id) via CSS; DOM order is creation order so a drag never moves the node.
  const layers = new Map(shown.map((o, i) => [o.id, i + 1]));
  const domOrder = [...shown].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // Rects arrows attach to, topmost last (story 10).
  const rects = new Map<string, Rect>();
  for (const o of shown) if (o.type !== 'connector') rects.set(o.id, objectBounds(o));

  /**
   * Select tool: the topmost object at a world point when it is one picked by hit test (an
   * arrow near its line); presses on anything else go to the objects' own DOM handlers.
   */
  const pickAt = (world: Point, zoom: number, target: EventTarget): string | null => {
    if (tool.tool !== 'select') return null;
    // Arrow end handles and an open editor handle their own presses.
    if (target instanceof Element && target.closest('[data-connector-handle], .is-editing')) return null;
    for (let i = shown.length - 1; i >= 0; i--) {
      const spec = getObjectType(shown[i].type)!;
      if (spec.hitTest(shown[i], world, zoom)) return spec.pickByHitTest ? shown[i].id : null;
    }
    return null;
  };

  const createAt = (world: Point) => {
    if (!editable) return;
    const id = step(() => createSticky(doc, world));
    if (id) startEdit(id);
  };
  const createStickyInView = () => {
    const viewport = viewportRef.current ?? { width: window.innerWidth, height: window.innerHeight };
    createAt(screenToWorld(getCamera(), { x: viewport.width / 2, y: viewport.height / 2 }));
  };
  useBoardKeys({
    doc,
    selection,
    snapshot: shown,
    canEdit: editable,
    undo: history,
    tool: toolControls,
    onCreateSticky: createStickyInView,
  });

  // Text tool click: new text there, being edited; the tool returns to Select. No boundary after
  // the creation: it forms one undo step with the first typing (and with the removal of text
  // left empty), so undo never brings back an empty text.
  const placeText = (world: Point) => {
    tool.setTool('select');
    if (!editable) return;
    boundary();
    const id = createText(doc, world, localIdentity());
    if (id) startEdit(id);
  };

  return (
    <UndoContext.Provider value={history}>
      <ImageContext.Provider value={imageContext}>
        <BoardViewport
          cameraRef={cameraRef}
          viewportRef={viewportRef}
          onPlace={tool.tool === 'text' ? placeText : undefined}
          pickAt={pickAt}
          onPick={(e, id) => transform.onObjectPointerDown(e, id)}
          toolLayer={({ camera }) =>
            tool.tool === 'shape' ? (
              <ShapeTool
                kind={tool.shapeKind}
                camera={camera}
                doc={doc}
                by={localIdentity()}
                onCreated={tool.toolCreated}
              />
            ) : tool.tool === 'pen' ? (
              <PenTool
                camera={camera}
                color={pen.color}
                thickness={pen.thickness}
                doc={doc}
                identityId={localIdentity()}
              />
            ) : tool.tool === 'connector' ? (
              <ConnectorTool
                camera={camera}
                snapshot={shown}
                doc={doc}
                by={localIdentity()}
                onCreated={tool.toolCreated}
              />
            ) : null
          }
          drop={images}
          onEmptyDoubleClick={createAt}
          onEmptyClick={clear}
          marquee={{ snapshot: shown, onSelect: (ids) => setMany(ids, true) }}
          overlay={({ camera, viewport }) => (
            <>
              <DropHighlight visible={images.dragging} />
              <div className="selection-layer">
                <SelectionOverlay
                  ids={selection.ids}
                  snapshot={shown}
                  camera={camera}
                  interactive={editable && editingId === null && tool.tool === 'select'}
                  onHandlePointerDown={transform.onHandlePointerDown}
                />
                <SelectionBar
                  ids={selection.ids}
                  snapshot={shown}
                  camera={camera}
                  editable={editable}
                  hidden={transform.gesture !== null || editingId !== null}
                  onDelete={deleteSelection}
                  onColor={(id, color) => {
                    if (editable) step(() => setStickyColor(doc, id, color));
                  }}
                  onShapeStyle={(id, style) => {
                    if (editable) step(() => setShapeStyle(doc, id, style));
                  }}
                  onTextSize={(id, size) => {
                    // The top-left stays; the box is re-measured in the same step.
                    if (editable)
                      step(() => {
                        if (setTextSize(doc, id, size)) syncTextBox(doc, id, textMeasurer());
                      });
                  }}
                />
              </div>
              <Toolbar
                disabled={!editable}
                undo={undo}
                tool={tool.tool}
                onTool={setTool}
                shapeKind={tool.shapeKind}
                onShapeKind={(k) => {
                  tool.setShapeKind(k);
                  tool.setTool('shape');
                }}
                pen={{
                  color: pen.color,
                  thickness: pen.thickness,
                  onColor: pen.setColor,
                  onThickness: pen.setThickness,
                }}
                onCreateSticky={() =>
                  createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }))
                }
              />
            </>
          )}
        >
          {({ camera }) =>
            domOrder.map((obj) => {
              const { Component } = getObjectType(obj.type)!;
              return (
                <Component
                  key={obj.id}
                  layer={layers.get(obj.id)}
                  rects={rects}
                  object={obj}
                  doc={doc}
                  zoom={camera.zoom}
                  selected={selection.ids.has(obj.id)}
                  editing={obj.id === editingId}
                  editable={editable}
                  transforming={transform.gesture !== null}
                  onPointerDown={transform.onObjectPointerDown}
                  onSelect={click}
                  onStartEdit={startEdit}
                  onEndEdit={endEdit}
                />
              );
            })
          }
        </BoardViewport>
      </ImageContext.Provider>
      {props.boardId && <ConnectionStatus state={connection} />}
      <Toast messages={toasts.messages} />
    </UndoContext.Provider>
  );
}
