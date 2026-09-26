import { useCallback, useEffect, type JSX } from 'react';
import * as Y from 'yjs';
import type { Point } from './canvas/camera';
import { screenToWorld, worldToScreen } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { CameraProvider, useCameraApi } from './canvas/useCamera';
import { BoardDocProvider, useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { createSticky, deleteObject, setStickyColor } from '../shared/board-model';

/** Fixed overlays that read the board camera: zoom control and first-use hint. */
export function BoardOverlays() {
  const { camera, hasNavigated, zoomStep, reset } = useCameraApi();

  return (
    <>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

/**
 * The main board content: sticky notes, viewport, toolbar, and keyboard handlers.
 * All sharing one doc and one selection state.
 */
function BoardContent() {
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const { camera } = useCameraApi();

  const handleDblClickEmpty = useCallback((worldPoint: Point) => {
    const id = createSticky(doc, worldPoint);
    startEdit(id);
  }, [doc, startEdit]);

  const handleEmptyClick = useCallback(() => {
    select(null);
  }, [select]);

  const handleCreateSticky = useCallback(() => {
    const viewportEl = document.querySelector('[data-testid="board-viewport"]') as HTMLElement | null;
    if (!viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const screenCenter: Point = { x: rect.width / 2, y: rect.height / 2 };
    const worldCenter = screenToWorld(camera, screenCenter);
    const id = createSticky(doc, worldCenter);
    startEdit(id);
  }, [doc, camera, startEdit]);

  const handleColorChange = useCallback((id: string, color: string) => {
    setStickyColor(doc, id, color);
  }, [doc]);

  const handleDelete = useCallback((id: string) => {
    deleteObject(doc, id);
    select(null);
  }, [doc, select]);

  // Keyboard handlers for Delete/Backspace and Enter on selected notes
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      // Enter: start editing the selected note
      if (event.key === 'Enter' && selectedId && editingId === null) {
        event.preventDefault();
        startEdit(selectedId);
        return;
      }

      // Delete/Backspace: delete selected note (only when not editing)
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && editingId === null) {
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, startEdit, select]);

  const selectedNote = selectedId ? notes.find((n) => n.id === selectedId) : undefined;

  return (
    <>
      <Toolbar onCreateSticky={handleCreateSticky} />
      <BoardViewport
        onDblClickEmpty={handleDblClickEmpty}
        onEmptyClick={handleEmptyClick}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}

          />
        ))}
      </BoardViewport>
      {selectedNote && !editingId && (
        <NoteToolbarOverlay
          note={selectedNote}
          camera={camera}
          onColor={handleColorChange}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}

/** Screen-space toolbar above the selected note. */
function NoteToolbarOverlay({ note, camera, onColor, onDelete }: {
  note: { id: string; x: number; y: number; color: import('../shared/config').StickyColor };
  camera: { x: number; y: number; zoom: number };
  onColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
}) {
  const screenPos = worldToScreen(camera, { x: note.x, y: note.y });
  return (
    <div
      className="note-toolbar-screen"
      style={{ left: screenPos.x, top: screenPos.y - 36 }}
    >
      <NoteToolbar
        color={note.color}
        onColor={(c) => onColor(note.id, c)}
        onDelete={() => onDelete(note.id)}
      />
    </div>
  );
}

/** The full board application, exportable with an optional doc for testing. */
export function BoardApp({ doc }: { doc?: Y.Doc } = {}): JSX.Element {
  return (
    <CameraProvider>
      <BoardDocProvider doc={doc}>
        <BoardContent />
        <BoardOverlays />
      </BoardDocProvider>
    </CameraProvider>
  );
}

export default function App() {
  return <BoardApp />;
}
