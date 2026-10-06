/**
 * The board: document, objects, selection, keyboard, toolbar, overlay, and the generic
 * transform gesture (stories 1–7).
 */
import { encodeStateVector } from 'yjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { useBoardCamera } from './canvas/CameraProvider';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { IS_TEST_MODE, registerTestHooks } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useUndo } from './board/useUndo';
import { useActiveTool } from './tools/useActiveTool';
import { ShapeTool, type ShapeCreateRequest } from './tools/ShapeTool';
import { ConnectorTool, type ConnectorCreateRequest } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { getObjectType, type BoardObjectComponent } from './objects/registry';
import type { ObjectProps } from './objects/ObjectProps';
import {
  createConnector,
  createShape,
  createSticky,
  deleteObjects,
  getShapeLabel,
  snapshot,
  stickySnapshot,
} from '../shared/board-model';
import { SHAPE_LABEL_MAX_CHARS } from '../shared/config';
import { createText } from '../shared/objects/text';
import { isShapeTool } from '../shared/tools';

/**
 * Who an object this screen creates is attributed to. Story 6 (identities) is not in this build,
 * so everything made here is attributed to this screen; the field is stored so a later story can
 * fill it in without a schema change.
 */
const LOCAL_AUTHOR = 'local';

export function Board(props: { boardId: string }) {
  const { camera, size, getCamera, setCamera, hasNavigated, zoomStep, reset } = useBoardCamera();
  const { doc, objects, connection, undo } = useBoardDoc(props.boardId);

  // one list for everything: selection, marquee, keyboard and undo take every object, whatever
  // type it is, and each type is drawn by the component its registry spec names
  const selection = useSelection(objects);

  // Story 4: while the room cannot produce this board, nothing here may write.
  const editable = canEdit(connection);

  // Story 8: this person's own history. Leaving the board discards it; a reload starts empty.
  const history = useUndo(undo, editable);

  // Story 9 and 10: which tool this screen is holding, per screen and never shared with anyone else
  // on the board. It also decides what happens after a tool has made its object: back to Select,
  // with the new thing selected.
  const { tool, setTool, shapeKind, toolCreated } = useActiveTool({
    canEdit: editable,
    selection,
  });

  // Story 11: what the next stroke will be drawn with. Per screen, for this session only - the board
  // keeps the colour each stroke was drawn in, and never restyles one.
  const pen = usePenOptions();

  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  // ---- test-only handle (excluded from production builds) ----
  useEffect(() => {
    if (!IS_TEST_MODE) return;
    registerTestHooks({
      getCamera,
      setCamera,
      getDoc: () => doc,
      getNotes: () => stickySnapshot(doc),
      getObjects: () => snapshot(doc),
      connectionState: () => connectionRef.current,
      stateVector: () => Array.from(encodeStateVector(doc)),
      createNote: (x: number, y: number) => createSticky(doc, { x, y }),
      createTextAt: (x: number, y: number) => createText(doc, { x, y }, LOCAL_AUTHOR) ?? '',
      // Story 10: a test sets up shapes and arrows with the model, exactly as the tools do, and then
      // drives the pointers itself. The label is written the way typing would write it.
      createShapeAt: (shape) => {
        const rect = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
        const id = createShape(
          doc,
          { kind: shape.kind, rect, at: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } },
          LOCAL_AUTHOR,
        );
        if (id !== null && typeof shape.label === 'string' && shape.label.length > 0) {
          getShapeLabel(doc, id)?.insert(0, shape.label.slice(0, SHAPE_LABEL_MAX_CHARS));
        }
        return id ?? '';
      },
      createConnectorBetween: (from, to) => createConnector(doc, from, to, LOCAL_AUTHOR) ?? '',
    });
    return () => registerTestHooks(null);
  }, [doc, getCamera, setCamera]);

  /** Creates a note centred on a screen point and starts typing it. */
  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      // a new note is a step of its own; what gets typed into it is the next one
      history.boundary();
      const id = createSticky(doc, screenToWorld(getCamera(), point));
      history.boundary();
      if (!id) return;
      selection.startEdit(id);
    },
    [doc, editable, getCamera, history, selection],
  );

  /** The Sticky note button (and N): a note in the middle of what the user can see. */
  const createAtViewportCentre = useCallback(() => {
    createAtScreenPoint({ x: size.width / 2, y: size.height / 2 });
  }, [createAtScreenPoint, size.height, size.width]);

  /** The Text tool: a text object with its top-left corner where the board was clicked. */
  const createTextAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      // placing one is a step of its own; what gets typed into it is the next one
      history.boundary();
      const id = createText(doc, screenToWorld(getCamera(), point), LOCAL_AUTHOR);
      history.boundary();
      if (!id) return;
      // The tool hands over to Select, and the new text is selected and being written.
      setTool('select');
      selection.startEdit(id);
    },
    [doc, editable, getCamera, history, selection, setTool],
  );

  /** The Shape tool released its drag: one shape, then back to Select with it selected. */
  const createShapeFromTool = useCallback(
    (request: ShapeCreateRequest) => {
      if (!editable) return;
      // the shape is a step of its own; what gets typed into its label is the next one
      history.boundary();
      const id = createShape(
        doc,
        { kind: request.kind, rect: request.rect, at: request.at, square: request.square },
        LOCAL_AUTHOR,
      );
      history.boundary();
      if (id !== null) toolCreated(id);
    },
    [doc, editable, history, toolCreated],
  );

  /**
   * The Connector tool released its drag: one arrow, if the model will have it. A refusal - the same
   * object at both ends, or a line too short to be an arrow - leaves the tool armed to try again.
   */
  const createConnectorFromTool = useCallback(
    (request: ConnectorCreateRequest) => {
      if (!editable) return;
      history.boundary();
      const id = createConnector(doc, request.from, request.to, LOCAL_AUTHOR);
      history.boundary();
      if (id !== null) toolCreated(id);
    },
    [doc, editable, history, toolCreated],
  );

  // ---- Transform gesture ----
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    // story 8: a gesture is one step, from its first write to the pointer coming up
    onGestureStart: history.boundary,
    onGestureEnd: history.boundary,
    onDragStateChange: setDraggingId,
  });

  // ---- Keyboard ----
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undo: history,
    setTool,
    onCreateSticky: createAtViewportCentre,
  });

  // ---- Marquee ----
  const marquee = useMarquee(camera, objects, (ids) => {
    selection.setMany(ids, true);
  });

  // ---- Selection bar delete action ----
  const deleteSelection = useCallback(() => {
    if (!editable) return;
    // one delete is one step, whatever it happens to contain
    history.boundary();
    deleteObjects(doc, [...selection.ids]);
    history.boundary();
    selection.clear();
  }, [doc, editable, history, selection]);

  return (
    <>
      <BoardViewport
        onCreateAt={createAtScreenPoint}
        canEdit={editable}
        tool={tool}
        onCreateText={createTextAtScreenPoint}
        onClearSelection={() => { selection.clear(); }}
        onMarqueeBegin={(screen) => marquee.begin(screen)}
        onMarqueeMove={(screen) => marquee.move(screen)}
        onMarqueeEnd={() => marquee.end()}
        onMarqueeCancel={() => marquee.cancel()}
      >
        {objects.map((object) => {
          // The registry is the only place that knows which types exist: a new one is drawn, moved,
          // selected, deleted and undone without this file changing.
          const spec = getObjectType(object.type);
          const Component = spec?.Component as BoardObjectComponent | undefined;
          if (!Component) return null;
          const props: ObjectProps = {
            doc,
            zoom: camera.zoom,
            selected: selection.ids.has(object.id),
            editing: selection.editingId === object.id,
            dragging: draggingId === object.id,
            canEdit: editable,
            onSelect: selection.click,
            onToggle: selection.toggle,
            onStartEdit: selection.startEdit,
            onEndEdit: selection.endEdit,
            onObjectPointerDown: gesture.onObjectPointerDown,
            undo: history.controller,
          };
          return <Component key={object.id} note={object} {...props} />;
        })}
      </BoardViewport>
      {/* Story 10: a drawing tool owns the pointer while it is up, so nothing under it is panned,
          marquee-dragged or moved. The toolbar stays above both, so the person can always put the
          tool down with the mouse. */}
      {editable && isShapeTool(tool) ? (
        <ShapeTool kind={shapeKind} camera={camera} onCreate={createShapeFromTool} />
      ) : null}
      {editable && tool === 'connector' ? (
        <ConnectorTool camera={camera} snapshot={objects} onCreate={createConnectorFromTool} />
      ) : null}
      {/* Story 11: the Pen draws on its own surface too, and keeps its own counsel: it commits the
          stroke itself and does not hand over to Select, so the next stroke can start immediately.
          Its bar is the colour and thickness of the *next* stroke, and is kept out of the document. */}
      {editable && tool === 'pen' ? (
        <PenTool
          camera={camera}
          color={pen.color}
          thickness={pen.thickness}
          doc={doc}
          identityId={LOCAL_AUTHOR}
          undo={history.controller}
        />
      ) : null}
      {editable && tool === 'pen' ? (
        <PenToolbar
          color={pen.color}
          thickness={pen.thickness}
          onColor={pen.setColor}
          onThickness={pen.setThickness}
        />
      ) : null}
      {/* Marquee rectangle (screen-space overlay) */}
      <MarqueeRect rect={marquee.rect} camera={camera} />
      {/* Selection overlay: bounding box and handles */}
      {selection.ids.size > 0 && (
        <SelectionOverlay
          ids={selection.ids}
          snapshot={objects}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
      )}
      {/* Selection bar */}
      <SelectionBar ids={selection.ids} onDelete={deleteSelection} />
      <Toolbar
        onCreateSticky={createAtViewportCentre}
        canEdit={editable}
        tool={tool}
        shapeKind={shapeKind}
        onSelectTool={setTool}
        undo={{ canUndo: history.canUndo, canRedo: history.canRedo, onUndo: history.undo, onRedo: history.redo }}
      />
      <ConnectionStatus state={connection} />
      <BoardChrome
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
        hintVisible={!hasNavigated}
      />
    </>
  );
}

function BoardChrome(props: {
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
  hintVisible: boolean;
}) {
  return (
    <>
      <ZoomControls
        zoomPercent={props.zoomPercent}
        canZoomIn={props.canZoomIn}
        canZoomOut={props.canZoomOut}
        onZoomIn={props.onZoomIn}
        onZoomOut={props.onZoomOut}
        onReset={props.onReset}
      />
      <NavigationHint visible={props.hintVisible} />
    </>
  );
}
