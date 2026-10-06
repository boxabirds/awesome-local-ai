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
import { useMarquee, MarqueeRect } from './board/Marquee';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObjects, snapshot } from '../shared/board-model';

export function Board(props: { boardId: string }) {
  const { camera, size, getCamera, setCamera, hasNavigated, zoomStep, reset } = useBoardCamera();
  const { doc, notes, connection, undo } = useBoardDoc(props.boardId);
  const selection = useSelection(notes);

  // Story 4: while the room cannot produce this board, nothing here may write.
  const editable = canEdit(connection);

  // Story 8: this person's own history. Leaving the board discards it; a reload starts empty.
  const history = useUndo(undo, editable);

  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  // ---- test-only handle (excluded from production builds) ----
  useEffect(() => {
    if (!IS_TEST_MODE) return;
    registerTestHooks({
      getCamera,
      setCamera,
      getDoc: () => doc,
      getNotes: () => snapshot(doc),
      connectionState: () => connectionRef.current,
      stateVector: () => Array.from(encodeStateVector(doc)),
      createNote: (x: number, y: number) => createSticky(doc, { x, y }),
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

  /** The Sticky note button: a note in the middle of what the user can see. */
  const createAtViewportCentre = useCallback(() => {
    createAtScreenPoint({ x: size.width / 2, y: size.height / 2 });
  }, [createAtScreenPoint, size.height, size.width]);

  // ---- Transform gesture ----
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
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
    snapshot: notes,
    canEdit: editable,
    undo: history,
  });

  // ---- Marquee ----
  const marquee = useMarquee(camera, notes, (ids) => {
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
        onClearSelection={() => { selection.clear(); }}
        onMarqueeBegin={(screen) => marquee.begin(screen)}
        onMarqueeMove={(screen) => marquee.move(screen)}
        onMarqueeEnd={() => marquee.end()}
        onMarqueeCancel={() => marquee.cancel()}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={selection.editingId === note.id}
            dragging={draggingId === note.id}
            canEdit={editable}
            onSelect={selection.click}
            onToggle={selection.toggle}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            onObjectPointerDown={gesture.onObjectPointerDown}
            undo={history.controller}
          />
        ))}
      </BoardViewport>
      {/* Marquee rectangle (screen-space overlay) */}
      <MarqueeRect rect={marquee.rect} camera={camera} />
      {/* Selection overlay: bounding box and handles */}
      {selection.ids.size > 0 && (
        <SelectionOverlay
          ids={selection.ids}
          snapshot={notes}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
      )}
      {/* Selection bar */}
      <SelectionBar ids={selection.ids} onDelete={deleteSelection} />
      <Toolbar
        onCreateSticky={createAtViewportCentre}
        canEdit={editable}
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
