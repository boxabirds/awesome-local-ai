/**
 * Story 1–4 · the board chrome (`canEdit`, `BoardShell`).
 *
 * This is the whole stories 1–4 surface — viewport, notes, toolbars, connection
 * badge — lifted out of `App` when story 5 made routing its own concern. It is
 * a *presentation* of a board: it takes a viewport size and optionally a
 * document / connection state, and never decides whether the board it is being
 * shown exists. That question belongs to `BoardPage`, and keeping it out of here
 * is what lets the stories 1–4 component tests render the real tree with a fake
 * document and no provider.
 *
 * `canEdit` is the single editing switch (design `persist.client_status`): a
 * board that could not be loaded is read-only, because anything typed into it
 * would be a second, unrelated version of it.
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
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectionState';
import { useLiveTestHooks } from '../sync/testHooks';
import { createSticky, deleteObject } from '../../shared/board-model';


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
  const selection = useSelection(boardDoc);

  // The single editing switch (design `persist.client_status`): a board that
  // could not be loaded is read-only until a sync succeeds.
  const editable = canEdit(connectionState);

  useLiveTestHooks(boardDoc, connectionState);

  // Refs so the window keydown listener always reads the latest state without
  // being re-bound on every render.
  const selectedRef = useRef(selection.selectedId);
  const editingRef = useRef(selection.editingId);
  const editableRef = useRef(editable);
  selectedRef.current = selection.selectedId;
  editingRef.current = selection.editingId;
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

  const onEmptyClick = useCallback(() => {
    if (selection.editingId !== null) selection.endEdit('unselected');
    else selection.select(null);
  }, [selection]);

  const onDeleteNote = useCallback(
    (id: string) => {
      if (!editableRef.current) return;
      deleteObject(boardDoc, id);
      selection.select(null);
    },
    [boardDoc, selection],
  );

  // Keyboard: Enter starts editing the selected note; Delete/Backspace delete
  // it — but only when we are not editing text (then they edit characters).
  useEffect(() => {
    const isTypingTarget = (node: EventTarget | null): boolean => {
      const el = node as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return; // zoom shortcuts
      if (isTypingTarget(event.target)) return; // keys belong to the editor
      // A read-only board answers no editing keys either (only the ones that
      // would change the doc: Enter and Delete stay with the board).
      if (!editableRef.current) return;

      if (event.key === 'Enter') {
        if (editingRef.current !== null) return;
        const id = selectedRef.current;
        if (id) {
          event.preventDefault();
          selection.startEdit(id);
        }
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editingRef.current !== null) return;
        const id = selectedRef.current;
        if (id) {
          event.preventDefault();
          onDeleteNote(id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, onDeleteNote]);

  return (
    <CameraApiContext.Provider value={api}>
      <div className="board-root" data-testid="board-root">
        <BoardViewport onEmptyClick={onEmptyClick} onEmptyDoubleClick={createAtWorld}>
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={boardDoc}
              zoom={camera.zoom}
              editable={editable}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={(id) => selection.select(id)}
              onStartEdit={(id) => selection.startEdit(id)}
              onEndEdit={(next) => selection.endEdit(next)}
              onDelete={onDeleteNote}
            />
          ))}
        </BoardViewport>
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
