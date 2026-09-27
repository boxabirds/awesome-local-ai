/**
 * Component-test harness: the same wiring as `App.tsx` (camera + board viewport +
 * Y.Doc snapshot + local selection + toolbars + board keyboard shortcuts), but
 * it hands the real `Y.Doc` to the test so assertions can read model state.
 */
import { useCallback, useEffect, useRef, type JSX } from 'react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useCamera } from '../../src/client/canvas/useCamera';
import type { Camera, Point, Size } from '../../src/client/canvas/camera';
import { screenToWorld } from '../../src/client/canvas/camera';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { Toolbar } from '../../src/client/board/Toolbar';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { createSticky, deleteObject } from '../../src/shared/board-model';
import type * as Y from 'yjs';

export const TEST_VIEWPORT: Size = { width: 800, height: 600 };

const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
};

export interface HarnessResult {
  doc: Y.Doc;
  getCamera(): Camera;
}

export function Harness({
  onReady,
  viewport = TEST_VIEWPORT,
}: {
  onReady(result: HarnessResult): void;
  viewport?: Size;
}): JSX.Element {
  const controls = useCamera(viewport);
  const { camera } = controls;
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;
  useEffect(() => {
    onReady({ doc, getCamera: () => cameraRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) select(null);
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

  const stateRef = useRef({ selectedId, editingId, doc, select, startEdit });
  useEffect(() => {
    stateRef.current = { selectedId, editingId, doc, select, startEdit };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = stateRef.current;
      if (isTextEntry(event.target)) return;
      if (event.key === 'Enter') {
        if (state.editingId !== null || state.selectedId === null) return;
        event.preventDefault();
        state.startEdit(state.selectedId);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.editingId !== null || state.selectedId === null) return;
        event.preventDefault();
        if (deleteObject(state.doc, state.selectedId)) state.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main data-testid="app">
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
      <Toolbar
        onCreateSticky={() =>
          createAtPoint({ x: viewport.width / 2, y: viewport.height / 2 })
        }
      />
    </main>
  );
}

/** jsdom's fixed-size viewport used by all component tests. */
export const [VIEWPORT_WIDTH, VIEWPORT_HEIGHT] = [TEST_VIEWPORT.width, TEST_VIEWPORT.height];
