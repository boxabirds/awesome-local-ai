import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { reportConnectionState } from './canvas/testHooks';
import { createSticky, deleteObject, setStickyColor } from '../shared/board-model';
import { STICKY_SIZE_WORLD } from '../shared/config';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { worldToScreen } from './canvas/camera';

/**
 * Read the board id from `/b/:boardId`. Returns null for any other path.
 */
function boardIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/b\/([^/]+)\/?$/);
  if (!match) return null;
  return isValidBoardId(match[1]) ? match[1] : null;
}

/**
 * Top-level app: resolves the board from the URL, then renders the live board.
 * `/` redirects to a fresh board id (temporary; story 5 replaces this with
 * server-side board creation).
 */
export default function App() {
  const boardId = useMemo(boardIdFromPath, []);

  useEffect(() => {
    if (boardId === null) {
      window.location.replace(`/b/${newBoardId()}`);
    }
  }, [boardId]);

  if (boardId === null) return null;
  return <Board boardId={boardId} />;
}

/**
 * The live board for one board id: document, selection state, toolbar,
 * sticky notes, connection badge, and keyboard shortcuts.
 */
function Board({ boardId }: { boardId: string }) {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit, prune } = useSelection();

  // Publish the mapped state for long-running e2e tests (test builds only).
  useEffect(() => {
    reportConnectionState(connectionState);
  }, [connectionState]);

  // When a note disappears (e.g. deleted by someone else while we were
  // typing in or dragging it), clear our selection/editing for it.
  useEffect(() => {
    prune(new Set(notes.map((n) => n.id)));
  }, [notes, prune]);

  // Camera ref updated by BoardViewport via onCameraChange callback
  const cameraRef = useRef({ x: -640, y: -400, zoom: 1 });

  const onDblClickEmpty = useCallback((screenPoint: { x: number; y: number }) => {
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screenPoint);
    const id = createSticky(doc, world);
    if (id) {
      startEdit(id);
    }
  }, [doc, startEdit]);

  const onClickEmpty = useCallback(() => {
    select(null);
  }, [select]);

  const onCreateSticky = useCallback(() => {
    const cam = cameraRef.current;
    // Centre of the visible board area (viewport is 1280x800 default)
    const centre = { x: 640, y: 400 };
    const world = screenToWorld(cam, centre);
    const id = createSticky(doc, world);
    if (id) {
      startEdit(id);
    }
  }, [doc, startEdit]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter' && selectedId && !editingId) {
        e.preventDefault();
        startEdit(selectedId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, startEdit, select]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        onDblClickEmpty={onDblClickEmpty}
        onClickEmpty={onClickEmpty}
        onCameraChange={(cam) => { cameraRef.current = cam; }}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cameraRef.current.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={onCreateSticky} />
      {selectedId && !editingId && (() => {
        const selNote = notes.find(n => n.id === selectedId);
        if (!selNote) return null;
        const cam = cameraRef.current;
        const screen = worldToScreen(cam, { x: selNote.x, y: selNote.y });
        return (
          <div style={{ position: 'fixed', left: screen.x + (STICKY_SIZE_WORLD / 2) * cam.zoom, top: screen.y + STICKY_SIZE_WORLD * cam.zoom + 8, transform: 'translateX(-50%)', zIndex: 1000 }}>
            <NoteToolbar
              color={selNote.color}
              onColor={(c) => setStickyColor(doc, selectedId, c)}
              onDelete={() => { deleteObject(doc, selectedId); select(null); }}
            />
          </div>
        );
      })()}
    </>
  );
}
