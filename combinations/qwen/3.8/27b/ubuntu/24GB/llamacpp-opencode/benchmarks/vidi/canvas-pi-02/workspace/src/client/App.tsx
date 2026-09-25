import { useEffect, useRef, useState } from 'react';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import type { Size } from './canvas/camera';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useBoardActions } from './board/useBoardActions';
import { useBoardKeyboard } from './board/useBoardKeyboard';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';

/**
 * Resolve the board id from the URL (`/b/:boardId`). Unknown routes and `/`
 * land on a fresh board id (client-side for now; story 5 moves creation
 * server-side). Invalid ids in the URL are replaced, never trusted.
 */
function resolveBoardId(): string {
  const match = window.location.pathname.match(/^\/b\/([A-Za-z0-9_-]+)\/?$/);
  if (match !== null && isValidBoardId(match[1])) return match[1];
  const id = newBoardId();
  window.history.replaceState(null, '', `/b/${id}`);
  return id;
}

/**
 * Edit gate (persist.client_status): the board is locked ONLY while the room
 * reports it could not be loaded (`load_failed`, close code 4500). Every
 * other phase — including `reconnecting` after a storage failure (1011) —
 * stays editable: the board is readable and pending changes are re-sent on
 * reconnect. `null` is local-only mode (no board id): fully editable.
 */
export function canEdit(state: ConnectionState | null): boolean {
  return state !== 'load_failed';
}

/**
 * Top-level layout: full-window board plus the toolbars, the zoom controls
 * and the first-use hint. The camera, the Y.Doc and the local selection
 * each live in one hook instance shared by every piece.
 */
export function App() {
  const [boardId] = useState(resolveBoardId);
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  // Track the board area size; resizing the window only changes the viewport
  // size, never the camera (content stays fixed to the board's top-left).
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const api = useCamera(size);
  const { doc, notes, connectionPhase } = useBoardDoc(boardId);
  const selection = useSelection();
  // persist.client_status: create/drag/edit/colour/delete are no-ops while
  // the board is locked (load_failed); the Sticky note button is disabled.
  const editable = canEdit(connectionPhase);
  const actions = useBoardActions({ doc, api, size, selection, editable });
  useBoardKeyboard({ doc, selection, editable });

  return (
    <div className="vidi6-shell" ref={shellRef}>
      <BoardViewport api={api} onCreateStickyAt={actions.createAtScreenPoint} onEmptyClick={() => selection.select(null)}>
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={api.camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            editable={editable}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={actions.createAtCentre} disabled={!editable} />
      <ConnectionStatus phase={connectionPhase} />
      <ZoomControls
        zoomPercent={zoomPercent(api.camera)}
        canZoomIn={canZoomIn(api.camera)}
        canZoomOut={canZoomOut(api.camera)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
    </div>
  );
}
