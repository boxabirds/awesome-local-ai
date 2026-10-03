import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld, Camera } from './canvas/camera';
import { registerVidi6Hook } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { createSticky, deleteObject } from '../shared/board-model';
import { newBoardId } from '../shared/board-id';
import type { Point } from './canvas/camera';

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * Reads the board id from the URL pathname.
 * Expected format: /b/<boardId>
 * If no valid board id is found, redirects to /b/<newBoardId>.
 */
function getBoardIdFromUrl(): string | null {
  const pathname = window.location.pathname;
  const match = pathname.match(/^\/b\/(.+)$/);
  if (match) return match[1];
  return null;
}

/** Redirect to a new board if no board id in URL. Returns the board id. */
function resolveBoardId(): string {
  const id = getBoardIdFromUrl();
  if (id) return id;
  const newId = newBoardId();
  window.history.replaceState(null, '', `/b/${newId}`);
  return newId;
}

export function App() {
  const [boardId] = useState(resolveBoardId);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const cameraRef = useRef<Camera>(INITIAL_CAMERA);

  const handleCamera = useCallback((cam: Camera) => {
    cameraRef.current = cam;
    setCamera(cam);
  }, []);

  // Test hook for e2e (drives the production build via `wrangler dev`)
  useEffect(() => {
    registerVidi6Hook({
      getDoc: () => doc,
      createNotes: (n: number) => {
        const ids: string[] = [];
        for (let i = 0; i < n; i++) {
          const x = 200 + (i % 20) * 220;
          const y = 200 + Math.floor(i / 20) * 220;
          const id = createSticky(doc, { x, y }, 'yellow');
          if (id) ids.push(id);
        }
        return ids;
      },
    });
    // Expose connection state for nightly tests
    (window as any).__vidi6 = {
      ...(window as any).__vidi6,
      connectionState,
    };
  }, [doc, connectionState]);

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

  // Clear selection/editing when the selected note is deleted remotely
  useEffect(() => {
    if (selectedId !== null) {
      const obj = doc.getMap('objects').get(selectedId);
      if (!obj) {
        select(null);
      }
    }
    if (editingId !== null) {
      const obj = doc.getMap('objects').get(editingId);
      if (!obj) {
        endEdit('unselected');
      }
    }
  }, [notes, selectedId, editingId, doc, select, endEdit]);

  // Keyboard: Enter edits the selected note; Delete/Backspace delete it.
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
      <ConnectionStatus state={connectionState} />
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
