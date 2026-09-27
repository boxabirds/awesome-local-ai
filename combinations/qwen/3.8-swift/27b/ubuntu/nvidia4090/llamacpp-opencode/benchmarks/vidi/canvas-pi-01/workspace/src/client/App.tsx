// Top-level layout: full-window board with sticky notes, the left toolbar,
// the note toolbar, the zoom controls, the connection status badge and the
// first-use hint.
//
// Routes (story 3): the board is reached by address, /b/:boardId. `/` is a
// temporary client-side redirect to a freshly generated board id; story 5
// replaces it with server-side board creation.

import { useEffect, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Size,
} from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { installTestHooks } from './canvas/testHooks';
import { useCamera } from './canvas/useCamera';
import { ZoomControls } from './canvas/ZoomControls';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { createSticky, deleteObject, setStickyColor } from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { STICKY_SIZE_WORLD } from '../shared/config';

/**
 * Editing is allowed in every connection state except load_failed
 * (spec: persist.client_status). A load_failed board shows the red badge
 * "This board couldn't be loaded. Retrying…" and the provider keeps
 * retrying; the first successful sync re-enables editing without a reload.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

function parseBoardId(pathname: string): string | null {
  const match = /^\/b\/([^/]+)$/.exec(pathname);
  if (match === null || match[1] === undefined) return null;
  return isValidBoardId(match[1]) ? match[1] : null;
}

export function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const boardId = parseBoardId(pathname);

  // No valid board address: redirect to a fresh board (story 5 replaces this
  // with server-side creation). replaceState keeps the history clean.
  useEffect(() => {
    if (boardId === null) {
      const target = `/b/${newBoardId()}`;
      window.history.replaceState(null, '', target);
      setPathname(target);
    }
  }, [boardId]);

  if (boardId === null) return null;
  return <Board boardId={boardId} />;
}

/** Gap (screen px) between the note toolbar and the note's top edge. */
const NOTE_TOOLBAR_GAP_PX = 8;
/** Note toolbar height (screen px); the anchor sits that far above the note. */
const NOTE_TOOLBAR_HEIGHT_PX = 40;

function Board({ boardId }: { boardId: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  // Viewport size from a ResizeObserver; camera x,y are unchanged on resize.
  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cam = useCamera(size);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const editable = canEdit(connectionState);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection(notes);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Test-only hook (excluded from production builds).
  useEffect(() => {
    installTestHooks({
      setCamera: cam.setCamera,
      getDoc: () => doc,
      deleteNote: (id: string) => deleteObject(doc, id),
      connectionState,
    });
  }, [cam.setCamera, doc, connectionState]);

  const selectedNote = selectedId !== null ? (notes.find((n) => n.id === selectedId) ?? null) : null;

  /** Create a note centred on a screen point, then select and start editing it. */
  const createStickyAt = (screenPoint: { x: number; y: number }) => {
    if (!editable) return; // load_failed: no model mutation (persist.client_status)
    const world = screenToWorld(cam.camera, screenPoint);
    const id = createSticky(doc, world);
    startEdit(id);
  };

  // Keyboard: Enter starts editing the selected note; Delete/Backspace delete
  // it. Both are ignored while editing text (the textarea owns the keys) and
  // while focus is in any input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
      if (inField || selectedId === null || editingId !== null || !editable) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        startEdit(selectedId);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, editable, startEdit, select]);

  // Note toolbar: screen space, centred above the selected note. Hidden while
  // the board is load_failed so colour/delete are no-ops too.
  let noteToolbar = null;
  if (editable && selectedNote !== null && editingId === null && draggingId === null) {
    const centre = worldToScreen(cam.camera, {
      x: selectedNote.x + STICKY_SIZE_WORLD / 2,
      y: selectedNote.y,
    });
    noteToolbar = (
      <div
        className="note-toolbar-anchor"
        style={{
          left: centre.x,
          top: centre.y - NOTE_TOOLBAR_GAP_PX - NOTE_TOOLBAR_HEIGHT_PX,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <NoteToolbar
          color={selectedNote.color}
          onColor={(color) => setStickyColor(doc, selectedNote.id, color)}
          onDelete={() => {
            deleteObject(doc, selectedNote.id);
            select(null);
          }}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="app-root">
      <BoardViewport
        cam={cam}
        onEmptyClick={() => select(null)}
        onCreateStickyAt={createStickyAt}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            editable={editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            onDraggingChange={setDraggingId}
          />
        ))}
      </BoardViewport>
      <Toolbar
        disabled={!editable}
        onCreateSticky={() => createStickyAt({ x: size.width / 2, y: size.height / 2 })}
      />
      {noteToolbar}
      <ConnectionStatus state={connectionState} />
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </div>
  );
}
