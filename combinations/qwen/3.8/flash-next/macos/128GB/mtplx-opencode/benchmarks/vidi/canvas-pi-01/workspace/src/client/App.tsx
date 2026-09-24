/**
 * Story 1 · top-level layout.
 *
 * The camera lives in `useCamera`, created here with the measured size of the
 * board area, shared through `CameraApiContext`, and wired to the three
 * presentational pieces: the input surface, the zoom control and the hint.
 *
 * Story 2 adds the document model and the sticky notes on top of that
 * navigation surface: `useBoardDoc` owns the Y.Doc, `useSelection` the local
 * selection / editing state, and the two toolbars. Notes are rendered inside
 * the world layer; create-by-double-click, create-by-button, keyboard editing
 * and keyboard delete are wired here.
 */
import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import type { Size } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { CameraApiContext, useCamera, useViewportSize } from './canvas/useCamera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';

/**
 * The board, given the size of the area it occupies. Split out from `App` so
 * component tests can render the real tree with a fixed viewport size (and a
 * pre-seeded document).
 */
export function BoardShell({ viewport, doc }: { viewport: Size; doc?: Y.Doc }) {
  const api = useCamera(viewport);
  const camera = api.camera;
  const { doc: boardDoc, notes } = useBoardDoc(doc);
  const selection = useSelection();

  // Refs so the window keydown listener always reads the latest state without
  // being re-bound on every render.
  const selectedRef = useRef(selection.selectedId);
  const editingRef = useRef(selection.editingId);
  selectedRef.current = selection.selectedId;
  editingRef.current = selection.editingId;

  const createAtWorld = useCallback(
    (world: { x: number; y: number }) => {
      const id = createSticky(boardDoc, world);
      selection.startEdit(id);
    },
    [boardDoc, selection],
  );

  const createAtCentre = useCallback(() => {
    const centre = screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
    createAtWorld(centre);
  }, [camera, viewport.width, viewport.height, createAtWorld]);

  const onEmptyClick = useCallback(() => {
    if (selection.editingId !== null) selection.endEdit('unselected');
    else selection.select(null);
  }, [selection]);

  const onDeleteNote = useCallback(
    (id: string) => {
      deleteObject(boardDoc, id);
      selection.select(null);
    },
    [boardDoc, selection],
  );

  // Keyboard: Enter starts editing the selected note; Delete/Backspace delete
  // it — but only when we are not editing text (then they edit characters).
  useEffect(() => {
    const isTypingTarget = (node: EventTarget | null): boolean => {
      const el = node as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return; // zoom shortcuts
      if (isTypingTarget(event.target)) return; // keys belong to the editor

      if (event.key === 'Enter') {
        if (editingRef.current !== null) return;
        const id = selectedRef.current;
        if (id) {
          event.preventDefault();
          selection.startEdit(id);
        }
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editingRef.current !== null) return;
        const id = selectedRef.current;
        if (id) {
          event.preventDefault();
          onDeleteNote(id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, onDeleteNote]);

  return (
    <CameraApiContext.Provider value={api}>
      <div className="board-root" data-testid="board-root">
        <BoardViewport onEmptyClick={onEmptyClick} onEmptyDoubleClick={createAtWorld}>
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={boardDoc}
              zoom={camera.zoom}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={(id) => selection.select(id)}
              onStartEdit={(id) => selection.startEdit(id)}
              onEndEdit={(next) => selection.endEdit(next)}
              onDelete={onDeleteNote}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={createAtCentre} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => api.zoomStep('in')}
          onZoomOut={() => api.zoomStep('out')}
          onReset={() => api.reset()}
        />
        <NavigationHint visible={!api.hasNavigated} />
      </div>
    </CameraApiContext.Provider>
  );
}

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(stageRef);

  return (
    <div ref={stageRef} className="board-root" data-testid="board-stage">
      <BoardShell viewport={viewport} />
    </div>
  );
}