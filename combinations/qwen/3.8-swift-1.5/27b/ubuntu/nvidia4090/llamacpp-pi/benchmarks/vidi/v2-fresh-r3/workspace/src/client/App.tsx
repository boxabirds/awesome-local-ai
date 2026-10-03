import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld, Camera } from './canvas/camera';
import { registerVidi6Hook } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import type { Point } from './canvas/camera';

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function App() {
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const cameraRef = useRef<Camera>(INITIAL_CAMERA);

  const handleCamera = useCallback((cam: Camera) => {
    cameraRef.current = cam;
    setCamera(cam);
  }, []);

  // Test hook for e2e (drives the production build via `wrangler dev`)
  useEffect(() => {
    registerVidi6Hook({ getDoc: () => doc });
  }, [doc]);

  /** Creates a sticky note centred on a screen point, selects it, starts editing. */
  const createStickyAtScreen = useCallback(
    (p: Point) => {
      const world = screenToWorld(cameraRef.current, p);
      const id = createSticky(doc, world);
      if (id) {
        select(id);
        startEdit(id);
      }
    },
    [doc, select, startEdit],
  );

  /** Creates a sticky note at the centre of the visible board area. */
  const createStickyAtCentre = useCallback(() => {
    createStickyAtScreen({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }, [createStickyAtScreen]);

  // Keyboard: Enter edits the selected note; Delete/Backspace delete it.
  // Both are ignored while editing text (the keys edit characters instead)
  // and while focus is in any input.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (inField || editingId !== null || selectedId === null) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (deleteObject(doc, selectedId)) {
          select(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, select, startEdit]);

  return (
    <>
      <BoardViewport
        onCamera={handleCamera}
        onEmptyDoubleClick={createStickyAtScreen}
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
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyAtCentre} />
    </>
  );
}
