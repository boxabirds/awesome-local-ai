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
import type { StickyColor } from '../shared/config';

export function BoardApp({ boardId }: { boardId: string }) {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const editable = canEdit(connectionState);

  const [camState, setCamState] = useState({ x: 0, y: 0, zoom: 1, vw: 0, vh: 0 });

  const handleCameraChange = useCallback(
    (cam: { x: number; y: number; zoom: number }, vp: Size) => {
      setCamState({ x: cam.x, y: cam.y, zoom: cam.zoom, vw: vp.width, vh: vp.height });
    },
    [],
  );

  const handleCreateSticky = useCallback(() => {
    if (!editable) return;
    const centre = { x: camState.vw / 2, y: camState.vh / 2 };
    const world = screenToWorld(camState, centre);
    const id = createSticky(doc, world);
    select(id);
    startEdit(id);
  }, [doc, select, startEdit, camState, editable]);

  const handleDblClickEmpty = useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!editable) return;
      const id = createSticky(doc, worldPoint);
      select(id);
      startEdit(id);
    },
    [doc, select, startEdit, editable],
  );

  const handleEmptyClick = useCallback(() => { select(null); }, [select]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!selectedId || !editable) return;
      setStickyColor(doc, selectedId, color);
    },
    [doc, selectedId, editable],
  );

  const handleDelete = useCallback(() => {
    if (!selectedId || !editable) return;
    deleteObject(doc, selectedId);
    select(null);
  }, [doc, selectedId, select, editable]);

  const zoom = camState.zoom;
  const cam = camState;

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
          <NoteToolbar color={selectedNote.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
