import { useCallback, useEffect, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { CameraContext } from './canvas/CameraContext';
import { useCamera } from './canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld, type Point } from './canvas/camera';
import { initGlobalTestHooks, registerBoardTestHooks } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject, snapshot } from '@/shared/board-model';

export function App() {
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });

  const updateViewport = useCallback(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
  }, []);

  useEffect(() => {
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, [updateViewport]);

  const cameraState = useCamera(viewport);
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  useEffect(() => {
    initGlobalTestHooks();
  }, []);

  // Test-only: expose the board snapshot and doc (story 2 tests).
  useEffect(() => {
    registerBoardTestHooks(() => snapshot(doc), () => doc);
  }, [doc]);

  const createStickyAt = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      if (id) {
        startEdit(id);
      }
    },
    [doc, startEdit],
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
  }, [doc, editingId, selectedId, startEdit]);

  // If the selected or edited note disappears (deleted via the bin or
  // keyboard), clear the stale local state.
  useEffect(() => {
    const exists = (id: string | null) => id !== null && notes.some((n) => n.id === id);
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
      <BoardViewport onCreateStickyAt={createStickyAt} onClearSelection={() => select(null)}>
        {stableNotes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cameraState.camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyCenter} />
      <ZoomControls
        zoomPercent={zoomPercent(cameraState.camera)}
        canZoomIn={canZoomIn(cameraState.camera)}
        canZoomOut={canZoomOut(cameraState.camera)}
        onZoomIn={() => cameraState.zoomStep('in')}
        onZoomOut={() => cameraState.zoomStep('out')}
        onReset={cameraState.reset}
      />
      <NavigationHint visible={!cameraState.hasNavigated} />
    </CameraContext.Provider>
  );
}
