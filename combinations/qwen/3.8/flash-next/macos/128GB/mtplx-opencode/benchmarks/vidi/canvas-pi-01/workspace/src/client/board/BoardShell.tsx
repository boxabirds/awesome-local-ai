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
 * Story 7 added multi-selection on top of that surface. A *single*
 * {@link TransformController} (design Key decision 1) owns every object
 * gesture — move and resize — and reads its live values through a ref so the
 * handlers are never stale; the per-object interaction and the resize handles
 * both hand their deltas to it. Selection is the local `useSelection` set (never
 * written to the Y.Doc). Group *move*, *resize*, *delete* and the selection bar
 * are all driven from here, so no individual object type knows anything about
 * the selection it belongs to.
 */
import { useCallback, useEffect, useRef } from 'react';
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
import { StickyNote } from '../objects/StickyNote';
import { SelectionBar } from './SelectionBar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectionState';
import { useLiveTestHooks } from '../sync/testHooks';
import { allObjectIds, createSticky, deleteObjects, moveObjects } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';


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
  if (controllerRef.current === null) {
    controllerRef.current = createTransformController(() => liveRef.current);
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
      const id = createSticky(boardDoc, world);
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
    deleteObjects(boardDoc, ids);
    selection.clear();
  }, [boardDoc, selection]);

  const deleteOne = useCallback(
    (id: string) => {
      if (!editableRef.current) return;
      deleteObjects(boardDoc, [id]);
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

  // Board keyboard (design "Editing entry points" + acceptance criterion 10 —
  // a key while a text field is focused is handled by that field, not here).
  // Enter opens the editor on the selected note; Delete/Backspace remove the
  // whole selection; Escape clears it. A read-only board answers none of them.
  useEffect(() => {
    const isTypingTarget = (node: EventTarget | null): boolean => {
      const el = node as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Select-all is Ctrl/Cmd+A, so it has to be matched BEFORE the modifier
      // guard below (which shields the Ctrl/Cmd zoom shortcuts) and before the
      // "keys belong to the editor" guard lets a focused field keep Ctrl+A.
      if ((event.metaKey || event.ctrlKey) && (event.key === 'a' || event.key === 'A')) {
        if (isTypingTarget(event.target)) return; // the field owns Ctrl+A
        if (!editableRef.current) return;
        event.preventDefault();
        // Replace the selection with every object known to this client.
        selection.setMany(allObjectIds(notesRef.current), false);
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return; // zoom shortcuts
      if (isTypingTarget(event.target)) return; // keys belong to the editor
      if (!editableRef.current) return;
      const selected = selectionRef.current;

      if (event.key === 'Enter') {
        if (editingRef.current !== null) return;
        if (selected.length === 1) {
          event.preventDefault();
          selection.startEdit(selected[0]);
        }
        return;
      }

      if (event.key === 'Escape') {
        if (editingRef.current !== null) return; // the editor owns Escape itself
        if (selected.length > 0) {
          event.preventDefault();
          selection.clear();
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editingRef.current !== null) return;
        if (selected.length > 0) {
          event.preventDefault();
          deleteSelection();
        }
      } else if (event.key.startsWith('Arrow') && selected.length > 0) {
        // Nudge the whole selection by a fixed world step (Shift = a large
        // step). The keystroke is consumed so it neither pans nor scrolls.
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowUp') dy = -step;
        else if (event.key === 'ArrowDown') dy = step;
        if (dx !== 0 || dy !== 0) {
          const positions = new Map<string, { x: number; y: number }>();
          for (const note of notesRef.current) {
            if (selected.includes(note.id)) {
              positions.set(note.id, { x: note.x + dx, y: note.y + dy });
            }
          }
          moveObjects(boardDoc, positions);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, deleteSelection, boardDoc]);

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
        <Toolbar onCreateSticky={createAtCentre} disabled={!editable} />
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