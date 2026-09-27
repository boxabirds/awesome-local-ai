import { useEffect, useReducer } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import type { Doc } from 'yjs';

import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { CameraContext, useCamera } from '../../src/client/canvas/useCamera';
import { screenToWorld, type Camera } from '../../src/client/canvas/camera';
import { useSelection } from '../../src/client/board/useSelection';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { createSticky, deleteObject, snapshot } from '../../src/shared/board-model';

const VIEWPORT = { width: 1200, height: 800 };

export interface HarnessHandle {
  camera: Camera;
  selectedId: string | null;
  editingId: string | null;
  setCamera: (patch: Partial<Camera>) => void;
}

/**
 * A jsdom board for story 2 component tests: the camera context, an injected
 * document, the local selection hook and the board keyboard handling, wired the
 * same way `App` wires them. The test owns the document, so it can seed notes
 * and read them back to assert the document, not just the DOM.
 */
export function renderStickyBoard(doc: Doc): {
  view: RenderResult;
  handle: HarnessHandle;
} {
  const handle: HarnessHandle = {
    camera: { x: 0, y: 0, zoom: 1 },
    selectedId: null,
    editingId: null,
    setCamera: () => {},
  };

  function Harness() {
    const api = useCamera(VIEWPORT);
    handle.setCamera = (patch) => api.setCamera({ ...api.camera, ...patch });
    const selection = useSelection();
    const [, force] = useReducer((x: number) => x + 1, 0);

    useEffect(() => {
      const objects = doc.getMap('objects');
      const handler = () => force();
      objects.observeDeep(handler);
      return () => objects.unobserveDeep(handler);
    }, [doc]);

    handle.camera = api.camera;
    handle.selectedId = selection.selectedId;
    handle.editingId = selection.editingId;
    handle.setCamera = (patch) => api.setCamera({ ...api.camera, ...patch });

    const notes = snapshot(doc);

    // A note removed from the document drops out of selection and editing too.
    useEffect(() => {
      if (selection.selectedId !== null && !notes.some((n) => n.id === selection.selectedId)) {
        selection.select(null);
      }
      if (selection.editingId !== null && !notes.some((n) => n.id === selection.editingId)) {
        selection.endEdit('unselected');
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [notes, selection.selectedId, selection.editingId]);

    // Board keyboard, mirroring App.tsx.
    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        const active = document.activeElement as HTMLElement | null;
        const tag = (active?.tagName ?? '').toUpperCase();
        const inField = tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable === true;
        if (selection.editingId !== null || inField) return;
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (selection.selectedId === null) return;
          event.preventDefault();
          deleteObject(doc, selection.selectedId);
          selection.select(null);
        } else if (event.key === 'Enter') {
          if (selection.selectedId === null) return;
          event.preventDefault();
          selection.startEdit(selection.selectedId);
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [doc, selection.selectedId, selection.editingId]);

    const createAt = (point: { x: number; y: number }) => {
      const id = createSticky(doc, screenToWorld(api.camera, point));
      if (id !== '') selection.startEdit(id);
    };

    return (
      <CameraContext.Provider value={api}>
        <div data-testid="board-area" style={{ position: 'fixed', inset: 0 }}>
          <BoardViewport
            onEmptyDblClick={createAt}
            onEmptyClick={() => selection.select(null)}
          >
            {notes.map((note) => (
              <StickyNote
                key={note.id}
                note={note}
                doc={doc}
                zoom={api.camera.zoom}
                selected={selection.selectedId === note.id}
                editing={selection.editingId === note.id}
                onSelect={selection.select}
                onStartEdit={selection.startEdit}
                onEndEdit={selection.endEdit}
              />
            ))}
          </BoardViewport>
        </div>
      </CameraContext.Provider>
    );
  }

  const view = render(<Harness />);
  return { view, handle };
}

export function noteByIndex(view: RenderResult, index: number): HTMLElement {
  return view.getAllByTestId('sticky-note')[index] as HTMLElement;
}
