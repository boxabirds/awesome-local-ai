import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
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
import { canEdit, ConnectionStatus } from './sync/ConnectionStatus';
import { boardIdFromPathname, resolveBoardId } from './routing';
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

/** The connection badge, reading the state the board's provider reports. */
export function ConnectionBadge() {
  const { connection } = useBoardDoc();
  return <ConnectionStatus state={connection} />;
}

/**
 * The main board content: sticky notes, viewport, toolbar, and keyboard handlers.
 * All sharing one doc and one selection state.
 */
function BoardContent() {
  const { doc, notes, connection } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit, pruneTo } = useSelection();
  const { camera } = useCameraApi();

  // A board that could not be loaded is not editable (persist.load_failure):
  // every mutation below becomes a no-op, and the Sticky note button is
  // disabled. Nothing is buffered or pretended — the room is retried by the
  // provider and editing returns when a sync succeeds.
  const editable = canEdit(connection);

  useEffect(() => {
    // An editor open when the board locks must close: a textarea the user
    // types into while their notes are unreachable is worse than an editor
    // that closes on its own.
    if (!editable && editingId !== null) endEdit('unselected');
  }, [editable, editingId, endEdit]);

  // Someone else may delete the note I have selected or am typing in: drop
  // the stale ids so no editor is left pointing at a deleted note.
  const visibleIds = useMemo(() => new Set(notes.map((note) => note.id)), [notes]);
  useEffect(() => {
    pruneTo(visibleIds);
  }, [visibleIds, pruneTo]);

  const handleDblClickEmpty = useCallback((worldPoint: Point) => {
    if (!editable) return;
    const id = createSticky(doc, worldPoint);
    startEdit(id);
  }, [doc, startEdit, editable]);

  const handleEmptyClick = useCallback(() => {
    select(null);
  }, [select]);

  const handleCreateSticky = useCallback(() => {
    if (!editable) return;
    const viewportEl = document.querySelector('[data-testid="board-viewport"]') as HTMLElement | null;
    if (!viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const screenCenter: Point = { x: rect.width / 2, y: rect.height / 2 };
    const worldCenter = screenToWorld(camera, screenCenter);
    const id = createSticky(doc, worldCenter);
    startEdit(id);
  }, [doc, camera, startEdit, editable]);

  const handleColorChange = useCallback((id: string, color: string) => {
    if (!editable) return;
    setStickyColor(doc, id, color);
  }, [doc, editable]);

  const handleDelete = useCallback((id: string) => {
    if (!editable) return;
    deleteObject(doc, id);
    select(null);
  }, [doc, select, editable]);

  // Keyboard handlers for Delete/Backspace and Enter on selected notes
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      // A board that failed to load takes no keyboard edits either.
      if (!editable) return;

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
  }, [selectedId, editingId, doc, startEdit, select, editable]);

  // Render in a stable order. Stacking comes from each note's z-index style, so
  // ordering the list by z as well would move DOM nodes in the middle of a drag
  // — and moving a node out of the document drops pointer capture, freezing the
  // drag (visible as soon as a note that is not on top is moved).
  const renderedNotes = useMemo(
    () => [...notes].sort((a, b) => (a.id < b.id ? -1 : 1)),
    [notes],
  );

  const selectedNote = selectedId ? notes.find((n) => n.id === selectedId) : undefined;

  return (
    <>
      <Toolbar onCreateSticky={handleCreateSticky} editable={editable} />
      <BoardViewport
        onDblClickEmpty={handleDblClickEmpty}
        onEmptyClick={handleEmptyClick}
      >
        {renderedNotes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            editable={editable}
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
export function BoardApp({ doc, boardId }: { doc?: Y.Doc; boardId?: string } = {}): JSX.Element {
  return (
    <CameraProvider>
      <BoardDocProvider doc={doc} boardId={boardId}>
        <BoardContent />
        <BoardOverlays />
        <ConnectionBadge />
      </BoardDocProvider>
    </CameraProvider>
  );
}

/**
 * The board for the board id in the URL. `/` (or any path without a valid id)
 * starts a new board and puts its id in the address bar — temporary until
 * story 5 adds the board dashboard.
 */
export default function App(): JSX.Element {
  const [boardId, setBoardId] = useState<string>(resolveBoardId);

  useEffect(() => {
    const onPopState = () => {
      setBoardId(boardIdFromPathname(window.location.pathname) ?? resolveBoardId());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return <BoardApp boardId={boardId} />;
}
