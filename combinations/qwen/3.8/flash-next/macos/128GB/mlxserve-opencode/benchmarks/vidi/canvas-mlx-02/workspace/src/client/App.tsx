import { useCallback, useEffect, useMemo, useState } from 'react';
import { BoardViewportRoot, useBoardCamera } from './canvas/BoardViewport.tsx';
import { ZoomControls } from './canvas/ZoomControls.tsx';
import { NavigationHint } from './canvas/NavigationHint.tsx';
import { Toolbar } from './board/Toolbar.tsx';
import { useBoardDoc } from './board/useBoardDoc.ts';
import { useSelection } from './board/useSelection.ts';
import { ConnectionStatus } from './collab/ConnectionStatus.tsx';
import { StickyNote } from './objects/StickyNote.tsx';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld } from './canvas/camera.ts';
import { BOARD_ID_PATTERN, newBoardId } from '../shared/board-id.ts';
import {
  createSticky,
  deleteObject,
  setStickyColor,
  type StickySnapshot,
} from '../shared/board-model.ts';

// Resolve the board id from the History-API route `/b/:boardId` (TC-26). A bare
// '/' mints a fresh id and replaces the address so every board deep-links.
function readBoardId(): string {
  const match = /^\/b\/([^/?#]+)/.exec(location.pathname);
  if (match && BOARD_ID_PATTERN.test(match[1])) return match[1];
  const fresh = newBoardId();
  history.replaceState(null, '', `/b/${fresh}`);
  return fresh;
}

// True when focus is inside a text control, so board keyboard shortcuts must
// not hijack the keystroke.
function isEditableFocus(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true;
}

export default function App() {
  const [boardId, setBoardId] = useState(readBoardId);
  useEffect(() => {
    const onPop = () => setBoardId(readBoardId());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const { api, rootRef, viewport } = useBoardCamera();
  const board = useBoardDoc(boardId);
  const { doc, notes } = board;
  const selection = useSelection();
  const cam = api.camera;

  const { select, startEdit, endEdit, selectedId, editingId } = selection;

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
      setStickyColor(doc, id, color);
    },
    [doc],
  );

  const onDelete = useCallback(
    (id: string) => {
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
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
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
          onSelect={select}
          onStartEdit={startEdit}
          onEndEdit={endEdit}
          onColor={onColor}
          onDelete={onDelete}
        />
      )),
    [notes, doc, cam.zoom, selectedId, editingId, select, startEdit, endEdit, onColor, onDelete],
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

      <Toolbar onCreateSticky={onCreateSticky} />

      <ZoomControls
        zoomPercent={zoomPercent(cam)}
        canZoomIn={canZoomIn(cam)}
        canZoomOut={canZoomOut(cam)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </>
  );
}
