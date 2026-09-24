/**
 * Story 1–4 · the board chrome (`canEdit`, `BoardShell`).
 *
 * This is the whole stories 1–4 surface — viewport, notes, toolbars, connection
 * badge — lifted out of `App` when story 5 made routing its own concern. It is a
 * *presentation* of a board: it takes a viewport size and optionally a document /
 * connection state, and never decides whether the board it is being shown
 * exists. That question belongs to `BoardPage`, and keeping it out of here is
 * what lets the stories 1–4 component tests render the real tree with a fake
 * document and no provider.
 *
 * `canEdit` is the single editing switch (design `persist.client_status`): a
 * board that could not be loaded is read-only, because anything typed into it
 * would be a second, unrelated version of it.
 *
 * Story 8 adds the personal undo history. One {@link UndoController} (built by
 * {@link useUndo}) tracks only this tab's own edits; the transform controller is
 * given boundary hooks so a whole drag is one step, the toolbars and delete
 * actions run inside undo steps, and the Undo / Redo buttons + the extracted
 * {@link useBoardKeys} shortcuts all read the same history. A reload builds a
 * fresh controller, so a failed-then-retried board starts with an empty history
 * (PRD undo.session_only).
 */
import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from '../canvas/camera';
import type { Size } from '../canvas/camera';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { CameraApiContext, useCamera } from '../canvas/useCamera';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useMarquee } from './Marquee';
import { createTransformController, type ResizeMode } from './transformController';
import { useUndo } from './useUndo';
import { useBoardKeys, type BoardKeyDeps } from './useBoardKeys';
import { StickyNote } from '../objects/StickyNote';
import { SelectionBar } from './SelectionBar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectionState';
import { useLiveTestHooks } from '../sync/testHooks';
import { allObjectIds, createSticky, deleteObjects, moveObjects } from '../../shared/board-model';


export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * The board, given the size of the area it occupies. Split out from `App` so
 * component tests can render the real tree with a fixed viewport size (and a
 * pre-seeded document). With no `boardId` there is no network provider — the
 * board runs purely locally, which is what those tests want.
 */
export function BoardShell({
  viewport,
  doc,
  boardId,
  connectionState: connectionOverride,
}: {
  viewport: Size;
  doc?: Y.Doc;
  boardId?: string;
  /**
   * Component tests drive the five connection states without a server by
   * supplying the state directly; production leaves it undefined and follows
   * the live provider.
   */
  connectionState?: ConnectionState;
}) {
  const api = useCamera(viewport);
  const camera = api.camera;
  const { doc: boardDoc, notes, connectionState: liveState } = useBoardDoc(doc, boardId);
  const connectionState = connectionOverride ?? liveState;
  const selection = useSelection(notes);

  // The single editing switch (design `persist.client_status`): a board that
  // could not be loaded is read-only until a sync succeeds.
  const editable = canEdit(connectionState);

  useLiveTestHooks(boardDoc, connectionState);

  // The one transform controller (design Key decision 1). It reads live values
  // through `liveRef` so its gesture maths is never stale, and it is created
  // once — the object interaction and every resize handle share this instance.
  const liveRef = useRef({
    doc: boardDoc,
    camera,
    snapshot: notes,
    canEdit: editable,
    resizeMode: (_type: string): ResizeMode => 'both',
  });
  liveRef.current.doc = boardDoc;
  liveRef.current.camera = camera;
  liveRef.current.snapshot = notes;
  liveRef.current.canEdit = editable;
  const controllerRef = useRef<ReturnType<typeof createTransformController> | null>(null);
  // One personal history per document. A reload swaps `boardDoc`, so `useUndo`
  // builds a fresh controller over an empty stack (undo.session_only).
  const { undo: undoController, version } = useUndo(boardDoc);
  void version; // read so the toolbar buttons re-render when the stack changes
  const undoRef = useRef(undoController);
  undoRef.current = undoController;
  if (controllerRef.current === null) {
    // The gesture boundary opens a fresh undo step at the start of a drag and
    // closes it at the end, so 30 frames of one drag are one step and never merge
    // with the change before or after it (design "whole drag = one step").
    // The controller is created once, so the hooks read the CURRENT controller via
    // `undoRef` — after a reload they must not call the destroyed one.
    controllerRef.current = createTransformController(() => liveRef.current, {
      onStart: () => undoRef.current.boundary(),
      onEnd: () => undoRef.current.boundary(),
    });
  }
  const controller = controllerRef.current;

  // A single marquee controller for Shift+drag box-select. The camera is read
  // through a ref so a mid-drag zoom still maps the rectangle correctly.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const marquee = useMarquee(() => cameraRef.current);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const getSnapshot = useCallback(() => notesRef.current, []);

  // The current selection as a plain array, rebuilt each render for the object
  // interaction (a press needs it to decide single-vs-group drag).
  const selectedIds = [...selection.ids];
  const selectionRef = useRef<string[]>(selectedIds);
  selectionRef.current = selectedIds;

  // The editing note and editability, read by the keyboard handler without
  // re-binding the window listener every render.
  const editingRef = useRef<string | null>(selection.editingId);
  editingRef.current = selection.editingId;
  const editableRef = useRef(editable);
  editableRef.current = editable;

  const createAtWorld = useCallback(
    (world: { x: number; y: number }) => {
      if (!editableRef.current) return;
      // A create is its own undo step, isolated from the change before / after.
      const id = undoRef.current.step(() => createSticky(boardDoc, world));
      selection.startEdit(id);
    },
    [boardDoc, selection],
  );

  const createAtCentre = useCallback(() => {
    const centre = screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
    createAtWorld(centre);
  }, [camera, viewport.width, viewport.height, createAtWorld]);

  // A pointer-up on empty board space with no drag ends any open editor *and*
  // clears the selection (TC-22, TC-38): clicking off a note unselects it.
  const onEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Marquee (Shift+drag on empty space) selects the objects entirely inside the
  // released rectangle, replacing the previous selection. An empty box leaves it
  // unchanged (design "Marquee selection").
  const onMarquee = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      selection.setMany(ids, false);
    },
    [selection],
  );

  const deleteSelection = useCallback(() => {
    if (!editableRef.current) return;
    const ids = selectionRef.current;
    if (ids.length === 0) return;
    // A delete is one undo step: one Ctrl+Z brings the whole group back (TC-04).
    undoRef.current.step(() => deleteObjects(boardDoc, ids));
    selection.clear();
  }, [boardDoc, selection]);

  const deleteOne = useCallback(
    (id: string) => {
      if (!editableRef.current) return;
      undoRef.current.step(() => deleteObjects(boardDoc, [id]));
      selection.clear();
    },
    [boardDoc, selection],
  );

  const onSelect = useCallback(
    (id: string, additive: boolean) => {
      if (additive) selection.toggle(id);
      else selection.click(id);
    },
    [selection],
  );

  // Nudge the whole selection by a world delta (arrow keys): one nudge, one step.
  const nudgeSelection = useCallback(
    (dx: number, dy: number) => {
      if (!editableRef.current) return;
      const selected = selectionRef.current;
      const positions = new Map<string, { x: number; y: number }>();
      for (const note of notesRef.current) {
        if (selected.includes(note.id)) {
          positions.set(note.id, { x: note.x + dx, y: note.y + dy });
        }
      }
      if (positions.size > 0) undoRef.current.step(() => moveObjects(boardDoc, positions));
    },
    [boardDoc],
  );

  // The keyboard handler reads live state through this getter, so the window
  // listener is bound once (see `useBoardKeys`). Delete / nudge run inside undo
  // steps; undo / redo route to the personal history; Escape is swallowed mid
  // gesture. A read-only board answers none of them.
  const getKeyboardDeps = useCallback(
    (): BoardKeyDeps => ({
      getTransform: () => controllerRef.current!,
      getUndo: () => undoRef.current,
      getSelection: () => selectionRef.current,
      getEditing: () => editingRef.current,
      isEditable: () => editableRef.current,
      getAllIds: () => allObjectIds(notesRef.current),
      startEdit: (id) => selection.startEdit(id),
      clearSelection: () => selection.clear(),
      setMany: (ids, additive) => selection.setMany(ids, additive),
      deleteSelection,
      nudge: nudgeSelection,
    }),
    [selection, deleteSelection, nudgeSelection],
  );

  useBoardKeys(getKeyboardDeps);

  return (
    <CameraApiContext.Provider value={api}>
      <div className="board-root" data-testid="board-root">
        <BoardViewport
          onEmptyClick={onEmptyClick}
          onEmptyDoubleClick={createAtWorld}
          marquee={marquee}
          getSnapshot={getSnapshot}
          onMarquee={onMarquee}
        >
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={boardDoc}
              zoom={camera.zoom}
              editable={editable}
              selected={selection.ids.has(note.id)}
              editing={selection.editingId === note.id}
              controller={controller}
              undo={undoController}
              selection={selectedIds}
              onSelect={onSelect}
              onStartEdit={(id) => selection.startEdit(id)}
              onEndEdit={() => selection.endEdit()}
              onDelete={deleteOne}
            />
          ))}
        </BoardViewport>
        <SelectionBar
          count={selectedIds.length}
          onDelete={() => deleteSelection()}
        />
        <Toolbar
          onCreateSticky={createAtCentre}
          disabled={!editable}
          history={{
            canUndo: undoController.canUndo(),
            canRedo: undoController.canRedo(),
            onUndo: () => undoController.undo(),
            onRedo: () => undoController.redo(),
          }}
        />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => api.zoomStep('in')}
          onZoomOut={() => api.zoomStep('out')}
          onReset={() => api.reset()}
        />
        <NavigationHint visible={!api.hasNavigated} />
        {boardId !== undefined && <ConnectionStatus state={connectionState} />}
      </div>
    </CameraApiContext.Provider>
  );
}