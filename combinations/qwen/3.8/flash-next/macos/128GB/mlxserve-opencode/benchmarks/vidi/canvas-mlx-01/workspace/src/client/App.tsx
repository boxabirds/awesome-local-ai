import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport.js';
import { NavigationHint } from './canvas/NavigationHint.js';
import { ZoomControls } from './canvas/ZoomControls.js';
import { useCamera } from './canvas/useCamera.js';
import { screenToWorld, type Size } from './canvas/camera.js';
import { useBoardDoc } from './board/useBoardDoc.js';
import { useSelection } from './board/useSelection.js';
import { Toolbar } from './board/Toolbar.js';
import { StickyNote } from './objects/StickyNote.js';
import { createSticky, deleteObject } from '../shared/board-model.js';
import { registerBoardTestHooks } from './canvas/testHooks.js';

/** True when focus is in a text field, so board keyboard shortcuts stand down. */
const focusIsEditable = (): boolean => {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
};

/**
 * Top-level layout: the infinite board with its sticky notes, the left toolbar that
 * creates notes, the zoom control and the first-use hint. Notes live in a `Y.Doc`
 * created once per page (nothing is persisted in this story; a reload starts empty).
 */
export function App(): JSX.Element {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const camera = useCamera(viewport);
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();
  const { select, startEdit, endEdit } = selection;
  const zoom = camera.camera.zoom;

  // Paint notes in a stable creation order and stack them with CSS `z-index` (see
  // StickyNote). Re-ordering the DOM on `bringToFront` would re-insert the node the
  // pointer is captured on, fire `lostpointercapture` and cancel an in-flight drag.
  const stacked = useMemo(
    () => [...notes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [notes],
  );
  const onViewportSize = useCallback((size: Size): void => {
    setViewport(size);
  }, []);

  /** Create a note whose centre lands on a viewport-relative screen point. */
  const createAtScreen = useCallback(
    (screenPoint: { x: number; y: number }): void => {
      const world = screenToWorld(camera.camera, screenPoint);
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [camera.camera, doc, startEdit],
  );

  /** The toolbar button creates a note in the middle of the visible board area. */
  const createAtCentre = useCallback((): void => {
    createAtScreen({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreen, viewport.width, viewport.height]);

  // Board-level keyboard: Enter edits the selected note; Delete/Backspace removes it.
  // Both stand down while a note is being edited (then those keys belong to the textarea).
  const { selectedId, editingId } = selection;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (editingId !== null) return; // editing text owns the keys
      if (focusIsEditable()) return;
      if (selectedId === null) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        startEdit(selectedId);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, select, startEdit]);

  // Expose the real doc and selection to the component / e2e suites (test builds only).
  useEffect(() => {
    registerBoardTestHooks(
      () => doc,
      () => ({ selectedId, editingId }),
    );
  }, [doc, selectedId, editingId]);

  return (
    <>
      <BoardViewport
        api={camera}
        onViewportSize={onViewportSize}
        onCreateAtPoint={createAtScreen}
        onClearSelection={() => {
          select(null);
        }}
      >
        {stacked.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>

      <Toolbar onCreateSticky={createAtCentre} />

      <ZoomControls
        zoomPercent={camera.zoomPercent}
        canZoomIn={camera.canZoomIn}
        canZoomOut={camera.canZoomOut}
        onZoomIn={() => {
          camera.zoomStep('in');
        }}
        onZoomOut={() => {
          camera.zoomStep('out');
        }}
        onReset={camera.reset}
      />
      <NavigationHint visible={!camera.hasNavigated} />
    </>
  );
}
