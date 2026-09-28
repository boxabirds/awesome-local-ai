import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BoardViewportRoot, useBoardCamera } from '../canvas/BoardViewport.tsx';
import { ZoomControls } from '../canvas/ZoomControls.tsx';
import { NavigationHint } from '../canvas/NavigationHint.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useBoardDoc } from './useBoardDoc.ts';
import { useSelection } from './useSelection.ts';
import { ConnectionStatus } from '../collab/ConnectionStatus.tsx';
import type { ConnectionState, ProviderFactory } from '../collab/connectBoard.ts';
import { StickyNote } from '../objects/StickyNote.tsx';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld } from '../canvas/camera.ts';
import { SharePanel } from '../share/SharePanel.tsx';
import {
  createSticky,
  deleteObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model.ts';

// True when the board can be mutated at all (story 4). Everything else about a
// board stays usable while it is unloadable - you can pan, zoom and read it - so
// this one predicate is the only gate on every mutation path: toolbar creation,
// double-click creation, dragging, text editing, recolouring and deleting.
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

// True when focus is inside a text control, so board keyboard shortcuts must
// not hijack the keystroke.
function isEditableFocus(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true;
}

// The board itself: canvas, toolbar, zoom, connection badge, share panel - the
// whole of stories 1-4, for one board whose address it is given.
//
// It is a component rather than a page because a board is what a route *opens*,
// not what a route *is*: story 5 put the routing in <App /> and the checking of a
// link in <BoardPage />, and this is what a link that was checked renders. Both
// `boardId` and `makeProvider` are props: a board UI that read the address bar
// itself could not be rendered against a board a test chose, and the component
// suite (TC-23's read-only board, story 2's gesture tests) does exactly that.
export interface BoardAppProps {
  /** Which board this is: the code from the address that opened it. */
  boardId: string;
  makeProvider?: ProviderFactory;
}

export default function BoardApp({ boardId, makeProvider }: BoardAppProps) {

  const { api, rootRef, viewport } = useBoardCamera();
  const board = useBoardDoc(boardId, makeProvider);
  const { doc, notes } = board;
  const selection = useSelection();
  const cam = api.camera;

  const { select, startEdit, endEdit, selectedId, editingId } = selection;

  // The single editing gate for this render (see canEdit). Held in a ref too so
  // the mutation callbacks keep a stable identity when only the state changed.
  const editable = canEdit(board.connectionState);
  const connectionStateRef = useRef<ConnectionState>(board.connectionState);
  connectionStateRef.current = board.connectionState;

  // A remote delete must not leave a phantom selection/editor: drop any selected
  // or edited id that has left the document (TC-25).
  const liveIds = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
  const pruneTo = selection.pruneTo;
  useEffect(() => {
    pruneTo(liveIds);
  }, [liveIds, pruneTo]);

  // Mirror the live connection state + socket controls onto the test-only hook
  // for e2e reconnect assertions (TC-28/29/30); dead-code eliminated in prod.
  const provider = board.provider;
  useEffect(() => {
    const hook = window.__vidi6;
    if (import.meta.env.MODE !== 'test' || !hook) return;
    hook.connectionState = board.connectionState;
    hook.disconnect = () => provider?.disconnect?.();
    hook.connect = () => provider?.connect?.();
  }, [board.connectionState, provider]);

  // Create a note centred on a world point and immediately edit it.
  const createAt = useCallback(
    (world: { x: number; y: number }) => {
      if (!canEdit(connectionStateRef.current)) return;
      const id = createSticky(doc, world);
      startEdit(id);
    },
    [doc, startEdit],
  );

  // Toolbar button creates at the centre of the visible board area.
  const onCreateSticky = useCallback(() => {
    const centre = screenToWorld(cam, { x: viewport.width / 2, y: viewport.height / 2 });
    createAt(centre);
  }, [cam, viewport.width, viewport.height, createAt]);

  // Empty-space double-click creates centred on the clicked point.
  const onEmptyDoubleClick = useCallback((world: { x: number; y: number }) => createAt(world), [createAt]);

  // Empty-space click clears the selection (and ends any edit as unselected).
  const onEmptyClick = useCallback(() => {
    if (editingId !== null) endEdit('unselected');
    else select(null);
  }, [editingId, endEdit, select]);

  const onColor = useCallback(
    (id: string, color: string) => {
      if (!canEdit(connectionStateRef.current)) return;
      setStickyColor(doc, id, color);
    },
    [doc],
  );

  const onDelete = useCallback(
    (id: string) => {
      if (!canEdit(connectionStateRef.current)) return;
      deleteObject(doc, id);
      select(null);
    },
    [doc, select],
  );

  // Board-level keyboard: Enter starts editing the selected note; Delete /
  // Backspace delete it. Both are ignored while editing or while focus is in a
  // text control (so Backspace edits text instead of deleting the note).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (editingId !== null) return;
      if (isEditableFocus()) return;
      if (selectedId === null) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!canEdit(connectionStateRef.current)) return;
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (!canEdit(connectionStateRef.current)) return;
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingId, selectedId, doc, startEdit, select]);

  const renderedNotes = useMemo(
    () =>
      notes.map((note: StickySnapshot) => (
        <StickyNote
          key={note.id}
          note={note}
          doc={doc}
          zoom={cam.zoom}
          selected={note.id === selectedId}
          editing={note.id === editingId}
          editable={editable}
          onSelect={select}
          onStartEdit={startEdit}
          onEndEdit={endEdit}
          onColor={onColor}
          onDelete={onDelete}
        />
      )),
    // `editable` is a dependency so that a board which becomes uneditable (story 4)
    // actually re-renders its notes as read-only.
    [notes, doc, cam.zoom, selectedId, editingId, editable, select, startEdit, endEdit, onColor, onDelete],
  );

  return (
    <>
      <BoardViewportRoot
        api={api}
        rootRef={rootRef}
        onEmptyDoubleClick={onEmptyDoubleClick}
        onEmptyClick={onEmptyClick}
      >
        {renderedNotes}
      </BoardViewportRoot>

      <ConnectionStatus state={board.connectionState} />

      <Toolbar onCreateSticky={onCreateSticky} disabled={!editable} />

      <ZoomControls
        zoomPercent={zoomPercent(cam)}
        canZoomIn={canZoomIn(cam)}
        canZoomOut={canZoomOut(cam)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />

      <SharePanel boardId={boardId} connectionState={board.connectionState} />
    </>
  );
}
