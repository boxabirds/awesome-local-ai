import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObjects } from '../../shared/board-model';
import type { BoardObject } from '../../shared/board-model';
import { BoardViewport, type MarqueeHandlers } from '../canvas/BoardViewport';
import { useBoardCamera } from '../canvas/BoardViewport';
import {
  canZoomIn as canZoomInWith,
  canZoomOut as canZoomOutWith,
  screenToWorld,
  zoomPercent,
  type Camera,
  type Point,
} from '../canvas/camera';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { useBoardDoc } from './useBoardDoc';
import { useSelection, type UseSelectionResult } from './useSelection';
import { useTransformGesture, type TransformGestureHandlers } from './useTransformGesture';
import { useMarquee, MarqueeRect, type MarqueeState } from './Marquee';
import { useBoardKeys } from './useBoardKeys';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { Toolbar } from './Toolbar';
import { useUndo, type UseUndoResult } from './useUndo';
import { createUndo, type UndoController } from './undo';
import { reportConnectionState } from '../canvas/testHooks';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { getObjectType } from '../objects/registry';
import { SharePanel } from '../share/SharePanel';

/**
 * The board itself: an infinite, pannable, zoomable canvas (story 1) holding objects
 * (sticky notes since story 2), live-connected to a room (story 3) and saved
 * (story 4). Story 7 added the selection: a set of objects that can be moved,
 * resized and deleted together, by click, shift-click, marquee, select-all, arrow
 * keys or the bar above the board.
 *
 * What is wired here:
 *
 *   - `useSelection`   — which objects are selected (local state, never shared)
 *   - `useTransformGesture` — the one gesture that moves or resizes them
 *   - `useMarquee`     — the shift-drag box that adds to the selection
 *   - `useBoardKeys`   — select all, clear, nudge, delete
 *
 * The camera and the selection belong to this screen; only the objects are shared.
 * A board is given, never invented here: which board this is, and whether it exists,
 * is decided above this component (share.not_found).
 */
export function Board({ boardId }: { boardId: string }): ReactNode {
  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  // A board the room could not read is shown and not edited: the objects on the
  // screen are whatever the last successful read found, and writing into a board we
  // cannot see the whole of is how a board gets lost (persist.corrupt_snapshot).
  const canEdit = connectionState !== 'load_failed';

  // The camera is owned by <BoardViewport>, which is rendered by this component but
  // below it, so it comes back up through the chrome (which reads it from the
  // viewport's context). Screen-to-world conversion needs it: a marquee, a double-click
  // and a drag all arrive in screen pixels.
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);

  // This tab's undo history (story 8). One controller per board, made with the
  // document and thrown away when the board goes. The `boundary()` it hands round is
  // what turns each action — a drag, a keystroke burst, a delete, a nudge — into one
  // undo step; the controller itself only ever captures this tab's `LOCAL_ORIGIN`
  // transactions, so what it undoes is this person's work and no one else's.
  const undoController = useMemo<UndoController>(() => createUndo(doc), [doc]);
  useEffect(() => () => undoController.destroy(), [undoController]);
  const undoBoundary = useCallback((): void => {
    undoController.boundary();
  }, [undoController]);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit,
    onGestureStart: undoBoundary,
    onGestureEnd: undoBoundary,
  });
  const marquee = useMarquee(camera, objects, (ids): void => {
    selection.setMany(ids, true);
  });

  useBoardKeys({ doc, selection, snapshot: objects, canEdit, undo: undoController });
  const undoState = useUndo(undoController, canEdit);

  /** Delete what is selected, and stop selecting it. */
  const deleteSelection = useCallback((): void => {
    // One undoable step, so an accidental delete of a whole cluster comes back in one.
    undoBoundary();
    deleteObjects(doc, [...selection.ids]);
    undoBoundary();
    selection.clear();
  }, [doc, selection, undoBoundary]);

  const onCreated = useCallback(
    (id: string): void => {
      selection.click(id);
      selection.startEdit(id);
    },
    [selection],
  );

  const onEmptyDoubleClick = useCallback(
    (screen: Point): void => {
      if (!canEdit) return;
      const id = createSticky(doc, screenToWorld(camera, screen));
      if (id) onCreated(id);
    },
    [canEdit, camera, doc, onCreated],
  );

  // A click on empty board space clears the selection. (When editing, the editor
  // already ended on the same pointerdown, so this is a no-op then.)
  const onEmptyClick = useCallback((): void => {
    selection.clear();
  }, [selection]);

  // Closing a note's text editor: 'selected' is Escape (the note keeps the selection),
  // 'unselected' is a press somewhere else (that press decides the selection).
  const endObjectEdit = useCallback(
    (id: string, next: 'selected' | 'unselected'): void => {
      selection.endEdit();
      if (next === 'selected') selection.click(id);
    },
    [selection],
  );

  // A board that goes out of reach while a note is open on the screen closes it: the
  // editor would otherwise keep taking typing into a document nothing saves.
  useEffect(() => {
    if (!canEdit) selection.clear();
  }, [canEdit, selection]);

  // So the e2e suite can read the connection state as well as the badge.
  useEffect(() => {
    reportConnectionState(connectionState);
  }, [connectionState]);

  const marqueeHandlers: MarqueeHandlers = {
    begin: marquee.begin,
    move: marquee.move,
    end: () => marquee.end(),
    cancel: marquee.cancel,
  };

  // A board that could not be read has no selection to draw a box around, so Shift
  // there does what it did before story 7: nothing but the rectangle's absence.
  const marqueeForViewport: MarqueeHandlers | undefined = canEdit ? marqueeHandlers : undefined;

  return (
    <BoardViewport
      chrome={
        <BoardChrome
          doc={doc}
          boardId={boardId}
          objects={objects}
          selection={selection}
          gesture={gesture}
          marquee={marquee}
          onCamera={setCamera}
          onCreated={onCreated}
          onDeleteSelection={deleteSelection}
          connectionState={connectionState}
          canEdit={canEdit}
          undoController={undoController}
          undo={undoState}
        />
      }
      onEmptyClick={onEmptyClick}
      onEmptyDoubleClick={onEmptyDoubleClick}
      marquee={marqueeForViewport}
    >
      <BoardObjects
        doc={doc}
        objects={objects}
        selection={selection}
        gesture={gesture}
        canEdit={canEdit}
        endObjectEdit={endObjectEdit}
        undo={undoController}
      />
    </BoardViewport>
  );
}

/** Screen-space chrome: rail, share panel, zoom controls, hint, and the selection's own UI. */
function BoardChrome({
  doc,
  boardId,
  objects,
  selection,
  gesture,
  marquee,
  onCamera,
  onCreated,
  onDeleteSelection,
  connectionState,
  canEdit,
  undoController,
  undo,
}: {
  doc: Y.Doc;
  boardId: string;
  objects: readonly BoardObject[];
  selection: UseSelectionResult;
  gesture: TransformGestureHandlers;
  marquee: MarqueeState;
  onCamera(camera: Camera): void;
  onCreated(id: string): void;
  onDeleteSelection(): void;
  connectionState: ConnectionState;
  canEdit: boolean;
  undoController: UndoController;
  undo: UseUndoResult;
}): ReactNode {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();

  // Publish the camera upward: the board above needs it to turn screen pixels into
  // world units (the viewport owns the camera, and measures itself).
  useEffect(() => {
    onCamera(camera);
  }, [camera, onCamera]);

  const createStickyCentre = (): void => {
    if (!canEdit) return;
    const world = screenToWorld(camera, {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    // A new note is one undo step, closed before and after the single model call.
    undoController.boundary();
    const id = createSticky(doc, world);
    undoController.boundary();
    if (id) onCreated(id);
  };

  return (
    <>
      <Toolbar onCreateSticky={createStickyCentre} disabled={!canEdit} undo={undo} />
      <SharePanel boardId={boardId} />
      <ConnectionStatus state={connectionState} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomInWith(camera)}
        canZoomOut={canZoomOutWith(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={objects}
        doc={doc}
        onDelete={onDeleteSelection}
        undo={undoController}
      />
      <MarqueeRect rect={marquee.rect} camera={camera} />
    </>
  );
}

/** The objects, drawn in world space by whatever the registry holds for their kind. */
function BoardObjects({
  doc,
  objects,
  selection,
  gesture,
  canEdit,
  endObjectEdit,
  undo,
}: {
  doc: Y.Doc;
  objects: readonly BoardObject[];
  selection: UseSelectionResult;
  gesture: TransformGestureHandlers;
  canEdit: boolean;
  endObjectEdit(id: string, next: 'selected' | 'unselected'): void;
  undo: UndoController;
}): ReactNode {
  const { camera } = useBoardCamera();
  return (
    <>
      {objects.map((object) => {
        // A kind this screen has no registry entry for is not drawn at all — and so is
        // not selectable either (TC-08, TC-12).
        const spec = getObjectType(object.type);
        if (!spec) return null;
        const Component = spec.Component;
        return (
          <Component
            key={object.id}
            object={object}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(object.id)}
            editing={object.id === selection.editingId}
            editable={canEdit}
            onObjectPointerDown={gesture.onObjectPointerDown}
            onStartEdit={selection.startEdit}
            onEndEdit={(next: 'selected' | 'unselected'): void => {
              endObjectEdit(object.id, next);
            }}
            undo={undo}
          />
        );
      })}
    </>
  );
}

/** The camera before the viewport has measured itself: the board's own start point. */
const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
