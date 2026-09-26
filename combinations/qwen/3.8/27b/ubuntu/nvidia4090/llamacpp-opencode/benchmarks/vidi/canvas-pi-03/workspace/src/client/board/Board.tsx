import { useCallback, useEffect, useState } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { CameraContext } from '../canvas/CameraContext';
import { useCamera } from '../canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld, type Point } from '../canvas/camera';
import { registerBoardTestHooks } from '../canvas/testHooks';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { Toolbar } from './Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { SharePanel } from '../share/SharePanel';
import { createSticky, deleteObject, snapshot } from '@/shared/board-model';

/**
 * Story 4: the board is editable in every connection state except
 * `load_failed` — a board that could not be loaded must not accept edits
 * (they would be lost against the unreadable storage, and the UI says the
 * board is retrying, not editable). While connecting/reconnecting the
 * existing story-3 behaviour holds: edits apply locally and sync later.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * The full board UI for one existing board id (stories 1-4, plus the story 5
 * Share panel top-right). Extracted from App so the router can render it
 * only after the board's existence has been confirmed.
 */
export function Board({ id }: { id: string }) {
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });

  const updateViewport = useCallback(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
  }, []);

  useEffect(() => {
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, [updateViewport]);

  const cameraState = useCamera(viewport);
  const { doc, notes, connectionState } = useBoardDoc(id);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Test-only: expose the board snapshot and doc (story 2 tests).
  useEffect(() => {
    registerBoardTestHooks(() => snapshot(doc), () => doc);
  }, [doc]);

  // Test-only: keep the live connection state readable (story 3 tests).
  useEffect(() => {
    if (window.__vidi6) window.__vidi6.connectionState = connectionState;
  }, [connectionState]);

  // Story 4: all edit handlers are no-ops while the board failed to load.
  const editable = canEdit(connectionState);

  const createStickyAt = useCallback(
    (world: Point) => {
      if (!editable) return;
      const id = createSticky(doc, world);
      if (id) {
        startEdit(id);
      }
    },
    [doc, editable, startEdit],
  );

  const createStickyCenter = useCallback(() => {
    createStickyAt(
      screenToWorld(cameraState.camera, {
        x: viewport.width / 2,
        y: viewport.height / 2,
      }),
    );
  }, [cameraState.camera, createStickyAt, viewport.width, viewport.height]);

  // Keyboard: Enter edits the selected note; Delete/Backspace removes it —
  // both only when not editing text (while editing, keys go to the textarea).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (editingId !== null || inInput) return;
      if (!editable) return; // story 4: no edits while load failed
      if (selectedId === null) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, editable, editingId, selectedId, startEdit]);

  // If the selected or edited note disappears (deleted via the bin or
  // keyboard), clear the stale local state.
  useEffect(() => {
    const exists = (noteId: string | null) => noteId !== null && notes.some((n) => n.id === noteId);
    if (selectedId !== null && !exists(selectedId)) select(null);
    if (editingId !== null && !exists(editingId)) endEdit('unselected');
  }, [notes, selectedId, editingId, select, endEdit]);

  // Stable DOM order (creation order): reordering DOM nodes while a drag is
  // in progress would move the dragging node and make the browser implicitly
  // release its pointer capture, killing the drag. Visual stacking is done
  // with z-index (StickyNote uses note.z) instead of DOM order.
  const stableNotes = [...notes].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );

  return (
    <CameraContext.Provider value={cameraState}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport onCreateStickyAt={createStickyAt} onClearSelection={() => select(null)}>
        {stableNotes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cameraState.camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            editable={editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyCenter} disabled={!editable} />
      <ZoomControls
        zoomPercent={zoomPercent(cameraState.camera)}
        canZoomIn={canZoomIn(cameraState.camera)}
        canZoomOut={canZoomOut(cameraState.camera)}
        onZoomIn={() => cameraState.zoomStep('in')}
        onZoomOut={() => cameraState.zoomStep('out')}
        onReset={cameraState.reset}
      />
      <NavigationHint visible={!cameraState.hasNavigated} />
      {/* Story 5: share the board with a link (top-right). */}
      <SharePanel boardId={id} />
    </CameraContext.Provider>
  );
}
