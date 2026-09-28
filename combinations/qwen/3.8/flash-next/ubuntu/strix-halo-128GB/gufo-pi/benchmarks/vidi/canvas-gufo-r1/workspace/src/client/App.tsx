import { useCallback, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld, worldToScreen, type Size } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { createSticky, deleteObject, setStickyColor } from '../shared/board-model';
import { newBoardId } from '../shared/board-id';
import type { StickyColor } from '../shared/config';

interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/** Extract boardId from /b/:boardId, or redirect / to a new board. */
function getBoardId(): string | null {
  const match = window.location.pathname.match(/^\/b\/([A-Za-z0-9_-]{22})$/);
  return match ? match[1]! : null;
}

export function App() {
  const boardId = getBoardId();

  // If no boardId in URL, redirect to a new board
  if (!boardId) {
    const newId = newBoardId();
    window.history.replaceState(null, '', `/b/${newId}`);
    // Force a re-render by using the new ID
    return <BoardApp boardId={newId} />;
  }

  return <BoardApp boardId={boardId} />;
}

function BoardApp({ boardId }: { boardId: string }) {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  const editable = canEdit(connectionState);

  const [camState, setCamState] = useState<CameraState & { vw: number; vh: number }>({
    x: 0, y: 0, zoom: 1, vw: 0, vh: 0,
  });

  const handleCameraChange = useCallback(
    (cam: { x: number; y: number; zoom: number }, vp: Size) => {
      setCamState({ x: cam.x, y: cam.y, zoom: cam.zoom, vw: vp.width, vh: vp.height });
    },
    [],
  );

  // Create a sticky note at the centre of the visible viewport
  const handleCreateSticky = useCallback(() => {
    if (!editable) return;
    const centre: { x: number; y: number } = { x: camState.vw / 2, y: camState.vh / 2 };
    const world = screenToWorld(camState, centre);
    const id = createSticky(doc, world);
    select(id);
    startEdit(id);
  }, [doc, select, startEdit, camState, editable]);

  // Double-click on empty space creates a note centred on the clicked point
  const handleDblClickEmpty = useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!editable) return;
      const id = createSticky(doc, worldPoint);
      select(id);
      startEdit(id);
    },
    [doc, select, startEdit, editable],
  );

  // Click on empty space clears selection
  const handleEmptyClick = useCallback(() => {
    select(null);
  }, [select]);

  // Keyboard handler for Enter (start edit) and Delete/Backspace (delete note)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ignore if editing or if focus is in an input/textarea
      if (editingId) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (!selectedId) return;

      if (e.key === 'Enter') {
        if (!editable) return;
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!editable) return;
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    },
    [doc, editingId, selectedId, select, startEdit, editable],
  );

  // Handle colour change for the selected note
  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!selectedId || !editable) return;
      setStickyColor(doc, selectedId, color);
    },
    [doc, selectedId, editable],
  );

  // Handle delete button in NoteToolbar
  const handleDelete = useCallback(() => {
    if (!selectedId || !editable) return;
    deleteObject(doc, selectedId);
    select(null);
  }, [doc, selectedId, select, editable]);

  const zoom = camState.zoom;
  const cam = camState;

  // Find the selected note for toolbar positioning
  const selectedNote = selectedId ? notes.find((n) => n.id === selectedId) : null;
  const showNoteToolbar = selectedNote && !editingId;

  let noteToolbarStyle: React.CSSProperties | undefined;
  if (selectedNote && showNoteToolbar) {
    const screenPt = worldToScreen(cam, { x: selectedNote.x + 100, y: selectedNote.y });
    noteToolbarStyle = {
      position: 'fixed' as const,
      left: screenPt.x,
      top: screenPt.y - 40,
      transform: 'translateX(-50%)',
      zIndex: 1000,
    };
  }

  return (
    <div onKeyDown={handleKeyDown} data-testid="app-root" tabIndex={-1}>
      <ConnectionStatus state={connectionState} />
      <Toolbar onCreateSticky={handleCreateSticky} disabled={!editable} />
      <BoardViewport
        onDblClickEmpty={handleDblClickEmpty}
        onEmptyClick={handleEmptyClick}
        onCameraChange={handleCameraChange}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            editable={editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      {showNoteToolbar && selectedNote && (
        <div style={noteToolbarStyle}>
          <NoteToolbar
            color={selectedNote.color}
            onColor={handleColor}
            onDelete={handleDelete}
          />
        </div>
      )}
    </div>
  );
}
