/**
 * Top-level layout: the camera-driven board viewport, the Y.Doc with its note
 * snapshot, the local selection/editing state, the left toolbar and the board
 * keyboard shortcuts (Enter starts editing; Delete/Backspace removes the
 * selected note when not editing text).
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { useCamera } from './canvas/useCamera';
import { installTestHooks } from './canvas/testHooks';
import type { Camera, Point, Size } from './canvas/camera';
import { screenToWorld } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';

/** A keyboard shortcut must not steal typing from a form field. */
const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
};

const useViewportSize = (): Size => {
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = (): void =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
};

export default function App(): JSX.Element {
  const viewport = useViewportSize();
  const controls = useCamera(viewport);
  const { camera } = controls;
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit } = selection;

  // A note deleted while selected (bin button, another actor) must not stay selected.
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) {
      select(null);
    }
  }, [notes, selectedId, select]);

  const createAtPoint = useCallback(
    (screenPoint: Point): void => {
      const world = screenToWorld(camera, screenPoint);
      const id = createSticky(doc, world);
      if (id) {
        select(id);
        startEdit(id);
      }
    },
    [camera, doc, select, startEdit],
  );

  const createAtCentre = useCallback((): void => {
    createAtPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtPoint, viewport.width, viewport.height]);

  // --- keyboard: Enter edits the selected note; Delete/Backspace deletes it ----
  const handlersRef = useRef({ selectedId, editingId, doc, select, startEdit, endEdit });
  useEffect(() => {
    handlersRef.current = { selectedId, editingId, doc, select, startEdit, endEdit };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = handlersRef.current;
      if (isTextEntry(event.target)) return;
      if (event.key === 'Enter') {
        if (state.editingId !== null) return; // Enter adds a newline while editing
        if (state.selectedId === null) return; // nothing selected: nothing happens
        event.preventDefault();
        state.startEdit(state.selectedId);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        // While editing, these keys belong to the textarea.
        if (state.editingId !== null) return;
        if (state.selectedId === null) return;
        event.preventDefault();
        if (deleteObject(state.doc, state.selectedId)) state.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // --- test hooks (test builds only): jump the camera and read it back --------
  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;
  useEffect(
    () =>
      installTestHooks({
        setCamera: (next) => controls.setCamera(next),
        getCamera: () => cameraRef.current,
        reset: () => controls.reset(),
      }),
    [controls],
  );

  return (
    <main className="app" data-testid="app">
      <BoardViewport
        camera={camera}
        controls={controls}
        onEmptyDblClick={createAtPoint}
        onEmptyClick={() => select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            onDeleted={(id) => {
              if (selectedId === id) select(null);
            }}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCentre} />
    </main>
  );
}
