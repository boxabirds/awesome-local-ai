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
import { useTool } from './board/useTool';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { getObjectType, type BoardObjectComponent } from './objects/registry';
import type { ObjectProps } from './objects/ObjectProps';
import {
  createSticky,
  deleteObjects,
  snapshot,
  stickySnapshot,
} from '../shared/board-model';
import { createText } from '../shared/objects/text';

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

  // Story 9: Select or Text, per screen, never shared with anyone else on the board.
  const { tool, setTool } = useTool(editable);

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
